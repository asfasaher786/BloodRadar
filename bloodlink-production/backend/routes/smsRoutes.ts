import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { createEmergencyRequest, addAuditLog } from "../services/dbService";
import { normalizePhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { parseEmergencyTextWithAI } from "../services/geminiService";
import { resolveCity, DEFAULT_CITY } from "../config/regions";
import { CONFIG } from "../config/config";
import { notifyMatchingDonors } from "../lib/notifyService";

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

// Gateway authentication: when SMS_WEBHOOK_SECRET is configured, every
// webhook call must prove it knows the shared secret. Without it, anyone
// could raise SOS on behalf of arbitrary phone numbers.
function webhookAuthorized(req: any): boolean {
  const secret = CONFIG.SMS_WEBHOOK_SECRET;
  if (!secret) return true; // open webhook — dev default, prod warns at boot
  const header = String(req.headers["x-webhook-secret"] || "");
  if (header && header.length === secret.length && timingSafeEqual(Buffer.from(header), Buffer.from(secret))) return true;
  const auth = String(req.headers["authorization"] || "");
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    if (token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return true;
  }
  return false;
}

router.post("/incoming", async (req, res, next) => {
  try {
    if (!webhookAuthorized(req)) {
      return res.status(401).json({ error: "Invalid webhook credentials" });
    }
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
      // Parse failures are logged (audit + server log) so the team can see
      // what real-world messages the parsers can't handle and improve them.
      console.warn(`[SMS:incoming] unparseable message from ${normalizedSenderPhone}: "${messageBody}"`);
      await addAuditLog({
        action: "sms_parse_failed",
        actor: normalizedSenderPhone,
        detail: `Unparseable SMS: "${messageBody.slice(0, 200)}"`,
      });
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

    // Same donor alerting as the web flow: matching donors get in-app/SMS/
    // push alerts per their own preferences. Never blocks the reply.
    notifyMatchingDonors(result.sos).catch(err => {
      console.error("[notify] donor alert dispatch failed (SMS path):", err);
    });

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
