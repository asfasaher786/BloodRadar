import { Router } from "express";
import { z } from "zod";
import {
  getDonors,
  updateDonorAvailability,
  addDonorReview,
  logDonation,
  getInboxForDonor,
  getEmergencyById,
  acceptContactRequest,
  declineContactRequest,
} from "../services/dbService";
import { maskPhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { broadcastEvent } from "../services/events";

// Privacy rule: public donor listings NEVER contain a full phone number.
// The donor's own phone is only ever visible to the donor themselves (via
// /api/auth/me) and to a requester after the contact-reveal accept flow.
const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const donors = await getDonors();
    const masked = donors.map(d => ({
      ...d,
      phone: maskPhone(d.phone),
      phoneMasked: true,
    }));
    res.json(masked);
  } catch (err) {
    next(err);
  }
});

// Availability toggle identifies the donor from their session, never from
// a client-supplied phone in the body (previous hole, Phase 0 audit B4).
const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});

router.post("/toggle-availability", authMiddleware, async (req, res, next) => {
  try {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "isAvailable must be true or false" });
    }
    const updated = await updateDonorAvailability(req.auth!.sub, parsed.data.isAvailable);
    if (!updated) return res.status(404).json({ error: "Donor profile not found. Register first." });
    res.json({ success: true, donor: { ...updated, phone: maskPhone(updated.phone) } });
  } catch (err) {
    next(err);
  }
});

router.post("/log-donation", authMiddleware, async (req, res, next) => {
  try {
    const result = await logDonation(req.auth!.sub);
    if ("error" in result) return res.status(400).json({ error: result.error });
    res.json({ success: true, donor: { ...result.donor, phone: maskPhone(result.donor.phone) } });
  } catch (err) {
    next(err);
  }
});

// Donor inbox: contact requests from requesters, listed by SOS. The
// requester's number is masked until THIS donor accepts; after accepting,
// the real number is included (they earned it).
router.get("/inbox", authMiddleware, roleMiddleware("donor"), async (req, res, next) => {
  try {
    const items = await getInboxForDonor(req.auth!.sub);
    const enriched = [];
    for (const item of items) {
      const sos = await getEmergencyById(item.sosId);
      const isAcceptedByMe = item.status === "accepted";
      enriched.push({
        id: item.id,
        sosId: item.sosId,
        status: item.status,
        createdAt: item.createdAt,
        acceptedAt: item.acceptedAt,
        patientName: sos?.patientName || "Patient",
        bloodGroup: sos?.bloodGroup || "?",
        hospitalName: sos?.hospitalName || "Unknown hospital",
        city: sos?.city || "",
        unitsNeeded: sos?.unitsNeeded || 1,
        requesterPhone: isAcceptedByMe ? item.requesterPhone : maskPhone(item.requesterPhone),
        phoneRevealed: isAcceptedByMe,
      });
    }
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.post("/inbox/:id/accept", authMiddleware, roleMiddleware("donor"), async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 100);
    const result = await acceptContactRequest(id, req.auth!.sub);
    if ("error" in result) return res.status(400).json({ error: result.error });
    const sos = await getEmergencyById(result.request.sosId);
    broadcastEvent("contact-request-accepted", { sosId: result.request.sosId });
    res.json({
      success: true,
      message: "Your number has been shared with the requester. They will call you.",
      requesterPhone: result.request.requesterPhone,
      sos: sos ? {
        id: sos.id,
        patientName: sos.patientName,
        bloodGroup: sos.bloodGroup,
        hospitalName: sos.hospitalName,
        unitsNeeded: sos.unitsNeeded,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/inbox/:id/decline", authMiddleware, roleMiddleware("donor"), async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 100);
    const result = await declineContactRequest(id, req.auth!.sub);
    if ("error" in result) return res.status(400).json({ error: result.error });
    broadcastEvent("contact-request-declined", { sosId: result.request.sosId });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Reviews stay public (requesters usually have no account), but input is
// validated and sanitized. Rating is clamped 1-5.
const reviewSchema = z.object({
  patientName: z.string().trim().max(60).optional(),
  reviewerName: z.string().trim().max(60).optional(),
  rating: z.coerce.number().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5").optional(),
  comment: z.string().trim().max(300).optional(),
});

router.post("/:id/reviews", async (req, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid review" });
    }
    const { patientName, reviewerName, rating, comment } = parsed.data;
    const review = {
      id: "rev-" + Date.now(),
      patientName: sanitizeText(patientName || reviewerName || "", 60) || "Anonymous",
      rating: Number(rating) || 5,
      comment: sanitizeText(comment || "", 300),
      date: new Date().toISOString(),
    };
    const updated = await addDonorReview(sanitizeText(req.params.id, 80), review);
    if (!updated) return res.status(404).json({ error: "Donor not found" });
    res.json({ success: true, donor: { ...updated, phone: maskPhone(updated.phone) } });
  } catch (err) {
    next(err);
  }
});

export default router;
