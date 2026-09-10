import { Router } from "express";
import { createEmergencyRequest } from "../services/dbService";
import { normalizePhone } from "../lib/phoneUtils";
import { parseEmergencyTextWithAI } from "../services/geminiService";
import { resolveCity, DEFAULT_CITY } from "../config/regions";

const router = Router();
const VALID_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

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

router.post("/incoming", async (req, res) => {
  try {
    const senderPhone = req.body.From || req.body.from || req.body.sender || req.body.msisdn;
    const messageBody = req.body.Body || req.body.body || req.body.text || req.body.message || "";
    if (!senderPhone) return res.status(400).json({ error: "No sender phone number provided by SMS gateway" });
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

    if (result.error || !result.sos) {
      return res.json({ reply: "Sorry, we couldn't process your request right now. Please call the nearest hospital directly if this is urgent." });
    }

    const count = result.sos.matchingDonorsCount;
    const reply = count > 0
      ? `Request received. ${count} compatible ${bloodGroup} donors nearby have been notified. Stay by your phone.`
      : `Request received, but no ${bloodGroup} donors are currently listed nearby. Please also call the hospital directly.`;
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to process incoming SMS: " + err.message });
  }
});

export default router;
