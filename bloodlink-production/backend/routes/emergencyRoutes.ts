import { Router } from "express";
import { z } from "zod";
import {
  getEmergencies,
  getEmergencyById,
  getDonorByPhone,
  updateEmergencyStatus,
  createEmergencyRequest,
  createContactRequestsForSos,
  getFulfilledContactRequestForSos,
  deleteEmergency,
  addAuditLog,
} from "../services/dbService";
import { normalizePhone, maskPhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { authMiddleware, optionalAuthMiddleware, roleMiddleware } from "../middleware/auth";
import { broadcastEvent } from "../services/events";

const router = Router();

const BLOOD_GROUP_RE = /^(A|B|AB|O)[+-]$/;

const createSosSchema = z.object({
  patientName: z.string().trim().max(60).optional(),
  bloodGroup: z.string().trim().regex(BLOOD_GROUP_RE, "Blood group must look like A+, B-, O+"),
  unitsNeeded: z.coerce.number().int("Units must be a whole number").min(1, "At least 1 unit").max(50, "At most 50 units").optional(),
  hospitalId: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().min(7, "Phone number looks too short").max(20, "Phone number looks too long"),
  requiredBy: z.string().trim().max(30).optional(),
  reason: z.string().trim().max(200).optional(),
  urgency: z.string().trim().max(40).optional(),
  city: z.string().trim().max(50).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["Pending", "Fulfilled", "Cancelled"]),
  requesterCode: z.string().trim().max(40).optional(),
});

const contactRequestSchema = z.object({
  requesterCode: z.string().trim().min(8, "Requester code looks too short").max(40),
});

// Public board: requester phone masked, requesterCode stripped (it is the
// requester's secret — exposing it would let anyone impersonate them).
function publicSos(sos: any) {
  if (!sos) return sos;
  const { requesterCode, ...rest } = sos;
  return { ...rest, contactPhone: maskPhone(sos.contactPhone), phoneMasked: true };
}

router.get("/", async (_req, res, next) => {
  try {
    const list = await getEmergencies();
    res.json(list.map(publicSos));
  } catch (err) {
    next(err);
  }
});

// Anonymous by design: requesters never need an account to raise an SOS.
// The requester identity is their contact phone alone — validated here.
router.post("/", async (req, res, next) => {
  try {
    const parsed = createSosSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid SOS request" });
    }
    const d = parsed.data;

    const result = await createEmergencyRequest({
      contactPhone: normalizePhone(d.contactPhone),
      patientName: sanitizeText(d.patientName || "", 60) || "Patient (name not given)",
      bloodGroup: d.bloodGroup,
      unitsNeeded: d.unitsNeeded,
      hospitalId: d.hospitalId,
      requiredBy: sanitizeText(d.requiredBy || "", 30),
      reason: sanitizeText(d.reason || "", 200) || "Surgical critical emergency",
      urgency: sanitizeText(d.urgency || "", 40),
      city: d.city,
    });

    if (result.error) return res.status(400).json({ error: result.error });
    const sosPublic = publicSos(result.sos);
    broadcastEvent("emergency-created", sosPublic);
    res.json({
      success: true,
      request: sosPublic,
      // One-time requester code: save it — it proves YOU raised this SOS.
      requesterCode: result.requesterCode,
    });
  } catch (err) {
    next(err);
  }
});

// Requester sends a contact request for their SOS (proven by their one-time
// code). Matching donors get inbox items; first accept wins.
router.post("/:id/contact-request", async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 80);
    const parsed = contactRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Requester code is required" });
    }

    const sos = await getEmergencyById(id);
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });
    if (sos.requesterCode !== parsed.data.requesterCode) {
      return res.status(403).json({ error: "Requester code does not match this SOS." });
    }

    const requests = await createContactRequestsForSos(sos);
    // PII-free nudge so open donor inboxes refresh immediately.
    broadcastEvent("contact-request-created", { sosId: sos.id });
    res.json({ success: true, notifiedDonors: requests.length, message: requests.length > 0 ? `${requests.length} compatible donors have been notified.` : "No compatible donors are currently available in your city." });
  } catch (err) {
    next(err);
  }
});

// Requester polls this (or watches SSE) to learn when a donor accepted.
// Until then: waiting. After accept: the donor's real number.
router.get("/:id/reveal", async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 80);
    const code = sanitizeText(String(req.query.code || ""), 40);
    const sos = await getEmergencyById(id);
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });
    if (!code || sos.requesterCode !== code) {
      return res.status(403).json({ error: "Requester code does not match this SOS." });
    }

    const fulfilled = await getFulfilledContactRequestForSos(id);
    if (!fulfilled) {
      return res.json({ status: "waiting", message: "No donor has accepted yet. We'll notify you the moment someone does." });
    }
    const donor = await getDonorByPhone(fulfilled.donorPhone);
    res.json({
      status: "fulfilled",
      acceptedAt: fulfilled.acceptedAt,
      donor: donor
        ? { name: donor.name, bloodGroup: donor.bloodGroup, phone: donor.phone, city: donor.city }
        : { phone: fulfilled.donorPhone },
    });
  } catch (err) {
    next(err);
  }
});

// Status changes are privileged: the requester (via their one-time code) may
// cancel their own SOS or mark it fulfilled once the blood has arrived;
// admins may set any status for moderation. Requester actions are audited
// so "Lives Saved" numbers stay honest (they trace back to a real request).
router.patch("/:id/status", optionalAuthMiddleware, async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 80);
    if (!id) return res.status(400).json({ error: "Emergency id is required" });

    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid status" });
    }

    const sos = await getEmergencyById(id);
    if (!sos) return res.status(404).json({ error: "Emergency request not found" });

    const isAdmin = req.auth?.role === "admin";
    const isRequester = parsed.data.requesterCode && sos.requesterCode === parsed.data.requesterCode;
    // Requesters may cancel or mark fulfilled; admins may set anything.
    const requesterAllowed = isRequester && (parsed.data.status === "Cancelled" || parsed.data.status === "Fulfilled");
    if (!isAdmin && !requesterAllowed) {
      return res.status(403).json({ error: "Only the requester can close an SOS, or an admin can change its status." });
    }

    const updated = await updateEmergencyStatus(id, parsed.data.status);
    if (isRequester) {
      await addAuditLog({
        action: parsed.data.status === "Fulfilled" ? "sos_fulfilled_by_requester" : "sos_cancelled_by_requester",
        actor: "requester",
        sosId: sos.id,
        detail: `Requester marked SOS ${parsed.data.status} (${sos.bloodGroup}, ${sos.hospitalName || "hospital not specified"})`,
      });
    }
    broadcastEvent("emergency-status-changed", { id, status: parsed.data.status });
    res.json({ success: true, request: publicSos(updated) });
  } catch (err) {
    next(err);
  }
});

// Admin moderation: remove an SOS (spam/abuse).
router.delete("/:id", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 80);
    const removed = await deleteEmergency(id);
    if (!removed) return res.status(404).json({ error: "Emergency request not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
