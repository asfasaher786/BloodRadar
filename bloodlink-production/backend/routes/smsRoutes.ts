import { Router } from "express";
import { z } from "zod";
import { createEmergencyRequest } from "../services/dbService";
import { normalizePhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { parseEmergencyTextWithAI } from "../services/geminiService";
import { resolveCity, DEFAULT_CITY } from "../config/regions";

const router = Router();
const VALID_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

// SMS gateways disagree on field names (Twilio: From/Body, others: from/text,
// msisdn/message). Accept any of them; the route reads the first one present.
const smsIncomingSchema = z.object({
  From: z.string().trim().max(30).optional(),
  from: z.string().trim().max(30).optional(),
  sender: z.string().trim().max(30).optional(),
  msisdn: z.string().trim().max(30).optional(),
  Body: z.string().trim().max(500).optional(),
  body: z.string().trim().max(500).optional(),
  text: z.string().trim().max(500).optional(),
  message: z.string().trim().max(500).optional(),
});

function parseIncomingText(body: string): { bloodGroup?: string; city?: string } {
  const cleaned = (body || "").trim().toUpperCase();
  const parts = cleaned.split(/\s+/);
  const bloodGroup = VALID_GROUPS.find(g => parts.includes(g));
  // NOTE: this recognizes common shorthand for the cities currently in
  // SUPPORTED_CITIES (config/regions.ts). Adding a new city here means also
  // adding its common abbreviations to this check.
  const city = parts.some(p => p.startsWith("RAWALPINDI") || p === "RWP") ? resolveCity("Rawalpindi") : DEFAULT_CITY;
  return { bloodGroup, city };
}

router.post("/incoming", async (req, res, next) => {
  try {
    const parsed = smsIncomingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Malformed SMS gateway payload" });
    }
    const d = parsed.data;
    const senderPhone = d.From || d.from || d.sender || d.msisdn;
    const messageBody = sanitizeText(d.Body || d.body || d.text || d.message || "", 500);

    if (!senderPhone) {
      return res.status(400).json({ error: "No sender phone number provided by SMS gateway" });
    }
    const normalizedSenderPhone = normalizePhone(senderPhone);
    let { bloodGroup, city } = parseIncomingText(messageBody);

    // Strict format failed — try the real AI parser on messier real-world phrasing
    // before giving up. This is honest: if the AI also can't tell, we say so.
    if (!bloodGroup) {
      const aiResult = await parseEmergencyTextWithAI(messageBody);
      if (aiResult?.bloodGroup) {
        bloodGroup = aiResult.bloodGroup;
        city = aiResult.city;
      }
    }

    if (!bloodGroup) {
      return res.json({ reply: "Sorry, we couldn't read your blood group. Please text your blood group and city, e.g. 'O+ ISLAMABAD'. We're here to help." });
    }

    const result = await createEmergencyRequest({ contactPhone: normalizedSenderPhone, bloodGroup, city, reason: "Emergency SOS via SMS" });

    // Abuse controls (Phase 3): the same phone asking for the same blood
    // group again gets the honest answer — their open request still stands.
    if (result.duplicate) {
      return res.json({ reply: `We already have your open ${bloodGroup} request — no need to send it again. Donors are still being matched.` });
    }

    if (result.error || !result.sos) {
      return res.json({ reply: result.error || "Sorry, we couldn't process your request right now. Please call the nearest hospital directly if this is urgent." });
    }

    const count = result.sos.matchingDonorsCount;
    const reply = count > 0
      ? `Request received. ${count} compatible ${bloodGroup} donors nearby have been notified. Stay by your phone.`
      : `Request received, but no ${bloodGroup} donors are currently listed nearby. Please also call the hospital directly.`;
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

export default router;
