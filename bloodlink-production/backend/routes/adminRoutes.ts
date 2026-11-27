import { Router } from "express";
import QRCode from "qrcode";
import {
  addAuditLog,
  blockPhone,
  clearModerationSignals,
  forgetAdminDevice,
  getAcceptedContactRequests,
  getAdminSecurity,
  getAuditLogs,
  getBlockedPhones,
  getDonors,
  getEmergencies,
  getEmergencyById,
  getOrganizations,
  getOrganizationById,
  setAdminSecurity,
  setOrganizationStatus,
  unblockPhone,
} from "../services/dbService";
import {
  buildOtpauthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "../lib/totp";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { broadcastEvent } from "../services/events";
import { getSmsSendStats } from "../lib/smsProvider";

// Admin-only endpoints. Everything here is gated by role "admin" — a role
// granted at login only to OTP-verified phones listed in ADMIN_PHONES.
const router = Router();

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Audit trail of privacy-sensitive actions (SOS created, contact requests
// accepted/declined). Server-side only; never shown in public UI.
router.get("/audit", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const logs = await getAuditLogs();
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// Organization applications (Phase 3). Admins are the human gate on who gets
// to post on behalf of patients and update blood-bank stock. Phone numbers
// are visible here on purpose — approving an org means vouching for its
// verified phone identity.
router.get("/orgs", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const orgs = await getOrganizations();
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/:id/approve", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const org = await getOrganizationById(id);
    if (!org) return res.status(404).json({ error: "Organization application not found" });
    if (org.status !== "pending") {
      return res.status(409).json({ error: `This application was already ${org.status}.` });
    }
    const updated = await setOrganizationStatus(id, "approved", req.auth!.sub);
    await addAuditLog({ action: "org_approved", actor: req.auth!.sub, detail: `${org.name} (${org.type}) approved` });
    broadcastEvent("org-status-changed", { id, status: "approved" });
    res.json({ success: true, org: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/:id/reject", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const org = await getOrganizationById(id);
    if (!org) return res.status(404).json({ error: "Organization application not found" });
    if (org.status !== "pending") {
      return res.status(409).json({ error: `This application was already ${org.status}.` });
    }
    const updated = await setOrganizationStatus(id, "rejected", req.auth!.sub);
    await addAuditLog({ action: "org_rejected", actor: req.auth!.sub, detail: `${org.name} (${org.type}) rejected` });
    broadcastEvent("org-status-changed", { id, status: "rejected" });
    res.json({ success: true, org: updated });
  } catch (err) {
    next(err);
  }
});

// Moderation queue (Phase 3 + P3a-6): requests visitors have reported AND
// requests the system auto-flagged for fake/test-looking content. Reports,
// system flags and the requester phone are admin-only — moderation genuinely
// needs them, and they never leave this endpoint.
router.get("/reported", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    // Admin moderation sees sample rows too (P0-3 opt-in).
    const all = await getEmergencies({ includeSample: true });
    const reported = all
      .filter(e =>
        (Array.isArray(e.reports) && e.reports.length > 0) ||
        Boolean(e.flaggedBySystem)
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(e => {
        const { requesterCode, ...rest } = e;
        return rest;
      });
    res.json(reported);
  } catch (err) {
    next(err);
  }
});

// Admin decided a queue entry is legitimate — clear its reports AND system
// flags so it leaves the queue. Removing spam is the existing DELETE
// /api/emergencies/:id; blocking the requester is POST /reported/:id/block.
router.post("/reported/:id/dismiss", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const sos = await getEmergencyById(id, { includeSample: true });
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });
    const result = await clearModerationSignals(id);
    if (!result.ok) return res.status(500).json({ error: "Could not clear the reports" });
    await addAuditLog({ action: "sos_report_dismissed", actor: req.auth!.sub, sosId: id, detail: `Admin cleared reports and auto-flags on SOS ${id}` });
    broadcastEvent("sos-report-dismissed", { id });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// P3a-6 one-tap block: blocks the SOS's contact phone (they can never post
// again while blocked) and removes every SOS that phone has posted. This is
// the human answer to a spammer the caps and flags could only slow down.
router.post("/reported/:id/block", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const sos = await getEmergencyById(id, { includeSample: true });
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });

    const phone = sos.contactPhone;
    if (!phone) return res.status(400).json({ error: "This request has no contact phone to block." });

    const { entry, removedSosCount } = await blockPhone(phone, req.auth!.sub, "Blocked from the review queue");
    await addAuditLog({
      action: "phone_blocked",
      actor: req.auth!.sub,
      sosId: id,
      detail: `Admin blocked ${phone} and removed ${removedSosCount} request(s) (${sos.bloodGroup}, ${sos.hospitalName || "hospital not specified"})`,
    });
    broadcastEvent("sos-report-blocked", { id });
    res.json({ success: true, blocked: entry, removedSosCount });
  } catch (err) {
    next(err);
  }
});

// P3a-6 blocked-number list + unblock. Admins can reverse a block when a
// real person was caught up in a mistake — posting rights return, but the
// removed requests are not restored.
router.get("/blocked", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const list = await getBlockedPhones();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/blocked/:phone/unblock", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const phone = String(req.params.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "A phone number is required." });
    const removed = await unblockPhone(phone);
    if (!removed) return res.status(404).json({ error: "That number is not on the blocked list." });
    await addAuditLog({ action: "phone_unblocked", actor: req.auth!.sub, detail: `Admin unblocked ${phone}` });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// P3a-8: the admin's own account security — two-step verification (TOTP)
// and the list of devices that have signed in. The TOTP secret is returned
// exactly once, at enrollment, as a QR + plain text. Everything else here
// only ever reports ENABLED/REMAINING counts, never the secret.
// ---------------------------------------------------------------------------

router.get("/security", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const sec = await getAdminSecurity(req.auth!.sub);
    res.json({
      totpEnabled: Boolean(sec?.totpEnabled),
      pendingEnrollment: Boolean(sec?.pendingTotpSecret),
      recoveryCodesRemaining: Array.isArray(sec?.recoveryCodeHashes) ? sec.recoveryCodeHashes.length : 0,
      devices: (Array.isArray(sec?.knownDevices) ? sec.knownDevices : []).slice().reverse(),
    });
  } catch (err) {
    next(err);
  }
});

// Starts (or restarts) enrollment: fresh secret + 8 fresh recovery codes.
// Returns the secret and its QR exactly once; nothing is stored as active
// until /enroll/confirm proves the admin can generate a valid code.
router.post("/security/totp/enroll", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const phone = req.auth!.sub;
    const existing = await getAdminSecurity(phone);
    if (existing?.totpEnabled) {
      return res.status(409).json({ error: "Two-step verification is already enabled." });
    }
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes(8);
    // Plain recovery codes exist in the record ONLY while enrollment is
    // pending (so /enroll/confirm can hand them to the admin once). On
    // confirm they're hashed and the plain ones are gone forever.
    await setAdminSecurity({
      phone,
      totpEnabled: false,
      pendingTotpSecret: secret,
      pendingRecoveryCodes: recoveryCodes,
      knownDevices: Array.isArray(existing?.knownDevices) ? existing.knownDevices : [],
    });
    const otpauthUrl = buildOtpauthUrl(phone, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });
    await addAuditLog({ action: "admin_totp_enroll_started", actor: phone });
    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    next(err);
  }
});

router.post("/security/totp/enroll/confirm", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const phone = req.auth!.sub;
    const code = String(req.body?.code || "").trim();
    const sec = await getAdminSecurity(phone);
    if (!sec?.pendingTotpSecret) {
      return res.status(400).json({ error: "No pending setup found. Start enrollment first." });
    }
    if (!verifyTotp(sec.pendingTotpSecret, code)) {
      return res.status(400).json({ error: "That code didn't match. Check the app and try again." });
    }
    const recoveryCodes = Array.isArray(sec.pendingRecoveryCodes) ? sec.pendingRecoveryCodes : [];
    await setAdminSecurity({
      phone,
      totpEnabled: true,
      totpSecret: sec.pendingTotpSecret,
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      knownDevices: Array.isArray(sec.knownDevices) ? sec.knownDevices : [],
    });
    await addAuditLog({ action: "admin_totp_enabled", actor: phone });
    // The ONE moment recovery codes are visible. The admin must save them.
    res.json({ success: true, recoveryCodes });
  } catch (err) {
    next(err);
  }
});

// Disabling needs a CURRENT valid code — a stolen session cookie alone can't
// take the second factor off the account.
router.post("/security/totp/disable", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const phone = req.auth!.sub;
    const code = String(req.body?.code || "").trim();
    const sec = await getAdminSecurity(phone);
    if (!sec?.totpEnabled || !sec.totpSecret) {
      return res.status(409).json({ error: "Two-step verification is not enabled." });
    }
    if (!verifyTotp(sec.totpSecret, code)) {
      return res.status(400).json({ error: "That code didn't match. Try again." });
    }
    await setAdminSecurity({
      phone,
      totpEnabled: false,
      knownDevices: Array.isArray(sec.knownDevices) ? sec.knownDevices : [],
    });
    await addAuditLog({ action: "admin_totp_disabled", actor: phone });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/security/devices/:id", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const phone = req.auth!.sub;
    const id = String(req.params.id || "").trim();
    const removed = await forgetAdminDevice(phone, id);
    if (!removed) return res.status(404).json({ error: "Device not found." });
    await addAuditLog({ action: "admin_device_forgotten", actor: phone, detail: `device ${id.slice(0, 8)}… removed from known devices` });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// North Star metric (Phase 3): units of blood delivered through the
// platform — the sum of unitsNeeded over Fulfilled requests. Reported
// separately for REAL records and for sample/demo records so the founder
// never mistakes demo numbers for real impact. Time-to-first-contact is
// computed only from real accepted contact requests; null until it exists.
router.get("/metrics", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const [emergencies, donors, orgs, acceptedRequests] = await Promise.all([
      getEmergencies({ includeSample: true }),
      getDonors({ includeSample: true }),
      getOrganizations(),
      getAcceptedContactRequests({ includeSample: true }),
    ]);

    const fulfilled = emergencies.filter(e => e.status === "Fulfilled");
    const real = fulfilled.filter(e => e.isSample !== true);
    const sample = fulfilled.filter(e => e.isSample === true);

    const responseTimesMs: number[] = [];
    for (const a of acceptedRequests) {
      const sos = await getEmergencyById(a.sosId, { includeSample: true });
      if (!sos || !sos.createdAt || !a.acceptedAt) continue;
      const ms = new Date(a.acceptedAt).getTime() - new Date(sos.createdAt).getTime();
      if (ms >= 0) responseTimesMs.push(ms);
    }

    res.json({
      northStar: {
        unitsDeliveredReal: real.reduce((sum, e) => sum + (Number(e.unitsNeeded) || 1), 0),
        unitsDeliveredIncludingSample: fulfilled.reduce((sum, e) => sum + (Number(e.unitsNeeded) || 1), 0),
        fulfilledReal: real.length,
        fulfilledIncludingSample: fulfilled.length,
      },
      activity: {
        pendingSos: emergencies.filter(e => e.status === "Pending").length,
        totalDonors: donors.filter(d => d.isSample !== true).length,
        donorsIncludingSample: donors.length,
        pendingOrgApplications: orgs.filter(o => o.status === "pending").length,
        approvedOrganizations: orgs.filter(o => o.status === "approved").length,
        // P3a-7: today's SMS spend vs the global cap, so a runaway bill is
        // visible in the dashboard before the cap has to stop sends.
        sms: getSmsSendStats(),
      },
      medianTimeToFirstContactMs: median(responseTimesMs),
    });
  } catch (err) {
    next(err);
  }
});

// Anonymized CSV export (Phase 3): aggregate SOS records for research and
// partner reporting. NO patient names, NO phone numbers — nothing that can
// identify a requester. Admin-only, downloaded as an attachment.
router.get("/export.csv", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    // The CSV carries an isSample column, so sample rows are included.
    const all = await getEmergencies({ includeSample: true });
    const header = ["id", "createdAt", "fulfilledAt", "bloodGroup", "unitsNeeded", "city", "hospitalName", "urgency", "status", "postedBy", "isSample"];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = all
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(e => [
        e.id,
        e.createdAt,
        e.fulfilledAt || "",
        e.bloodGroup,
        e.unitsNeeded,
        e.city,
        e.hospitalName,
        e.urgency,
        e.status,
        e.postedBy === "organization" ? "organization" : "requester",
        e.isSample === true ? "sample" : "real",
      ].map(esc).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bloodradar-sos-${new Date().toISOString().split("T")[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
