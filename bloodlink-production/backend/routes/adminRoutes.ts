import { Router } from "express";
import {
  addAuditLog,
  clearEmergencyReports,
  getAcceptedContactRequests,
  getAuditLogs,
  getDonors,
  getEmergencies,
  getEmergencyById,
  getOrganizations,
  getOrganizationById,
  setOrganizationStatus,
} from "../services/dbService";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { broadcastEvent } from "../services/events";

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

// Moderation queue (Phase 3): requests visitors have reported. Reports and
// the requester phone are admin-only — moderation genuinely needs them, and
// they never leave this endpoint.
router.get("/reported", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const all = await getEmergencies();
    const reported = all
      .filter(e => Array.isArray(e.reports) && e.reports.length > 0)
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

// Admin decided a reported request is legitimate — clear its reports so it
// leaves the queue. Removing spam is the existing DELETE /api/emergencies/:id.
router.post("/reported/:id/dismiss", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const sos = await getEmergencyById(id);
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });
    const result = await clearEmergencyReports(id);
    if (!result.ok) return res.status(500).json({ error: "Could not clear the reports" });
    await addAuditLog({ action: "sos_report_dismissed", actor: req.auth!.sub, sosId: id, detail: `Admin cleared reports on SOS ${id}` });
    broadcastEvent("sos-report-dismissed", { id });
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
      getEmergencies(),
      getDonors(),
      getOrganizations(),
      getAcceptedContactRequests(),
    ]);

    const fulfilled = emergencies.filter(e => e.status === "Fulfilled");
    const real = fulfilled.filter(e => e.isSample !== true);
    const sample = fulfilled.filter(e => e.isSample === true);

    const responseTimesMs: number[] = [];
    for (const a of acceptedRequests) {
      const sos = await getEmergencyById(a.sosId);
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
    const all = await getEmergencies();
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
