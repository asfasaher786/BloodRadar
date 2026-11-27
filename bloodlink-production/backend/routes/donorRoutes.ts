import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import {
  getDonors,
  getDonorById,
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

// P2-7: public listings show first name + last initial only (never a full
// name). Review PATIENT names/comments/dates stay on the review endpoint;
// the list carries just the aggregate count/average.
function nameForPublicList(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Donor";
  if (parts.length === 1) return parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${parts[0]} ${lastInitial}.`;
}

router.get("/", async (_req, res, next) => {
  try {
    const donors = await getDonors();
    // Explicit allow-list (P2-7): name+initial, blood group, city, coarse
    // area, availability, verified — and nothing else. No coordinates, no
    // full names, no dates, no review content.
    const masked = donors.map(d => {
      const reviews = Array.isArray(d.reviews) ? d.reviews : [];
      const total = reviews.length;
      const average = total > 0
        ? Math.round((reviews.reduce((s: number, r: any) => s + (Number(r.rating) || 0), 0) / total) * 10) / 10
        : null;
      return {
        id: d.id,
        name: nameForPublicList(d.name),
        bloodGroup: d.bloodGroup,
        city: d.city,
        area: d.location || "",
        isAvailable: d.isAvailable,
        isVerified: d.isVerified,
        phone: maskPhone(d.phone),
        phoneMasked: true,
        stats: {
          donationsCount: d.stats?.donationsCount ?? 0,
          livesSaved: d.stats?.livesSaved ?? 0,
        },
        badges: d.badges || [],
        reviewsSummary: { count: total, average },
      };
    });
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

// Phase 2 (P2-7): reviews are no longer embedded in the public donor list.
// They are fetched per donor, and the reviewer's name is scrubbed to first
// name + last initial so no full third-party names sit in public payloads.
router.get("/:id/reviews", async (req, res, next) => {
  try {
    const id = sanitizeText(req.params.id, 80);
    const donor = await getDonorById(id);
    if (!donor) return res.status(404).json({ error: "Donor not found" });
    const reviews = (donor.reviews || []).map((r: any) => ({
      id: r.id,
      patientName: nameForPublicList(r.patientName || "Anonymous"),
      rating: r.rating,
      comment: sanitizeText(r.comment || "", 300),
      date: r.date,
    }));
    res.json({ reviews });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reviews", async (req, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid review" });
    }
    const { patientName, reviewerName, rating, comment } = parsed.data;
    const review = {
      id: "rev-" + crypto.randomUUID(),
      patientName: sanitizeText(patientName || reviewerName || "", 60) || "Anonymous",
      rating: Number(rating) || 5,
      comment: sanitizeText(comment || "", 300),
      date: new Date().toISOString(),
    };
    const updated = await addDonorReview(sanitizeText(req.params.id, 80), review);
    if (!updated) return res.status(404).json({ error: "Donor not found" });
    // P2-7: never echo the full donor object (it contains reviews, dates,
    // coordinates). The caller re-reads the allow-listed public data.
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
