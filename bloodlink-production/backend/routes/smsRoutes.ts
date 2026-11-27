import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { createEmergencyRequest, addAuditLog } from "../services/dbService";
import { normalizePhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { parseEmergencyTextWithAI } from "../services/geminiService";
import { resolveCity, DEFAULT_CITY } from "../config/regions";
import { CONFIG } from "../config/config";
import { logger } from "../lib/logger";
import { notifyMatchingDonors } from "../lib/notifyService";
import { sendSmsGuarded } from "../lib/smsProvider";
import {
  confirmSosReceived,
  confirmDuplicateRequest,
  confirmUnparseable,
  confirmProcessingFailed,
} from "../lib/smsConfirmBack";

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
      // P3a-1: parse failures go through the redacting logger — the sender
      // phone and message body are [REDACTED] in the log stream. The full
      // text is kept in the in-app audit log so the team can still improve
      // the parsers from real-world messages.
      logger.warn({ phone: normalizedSenderPhone, smsBody: messageBody }, "[SMS:incoming] unparseable message (phone/body redacted; full text in audit log)");
      await addAuditLog({
        action: "sms_parse_failed",
        actor: normalizedSenderPhone,
        detail: `Unparseable SMS: "${messageBody.slice(0, 200)}"`,
      });
      // P3b-2 confirm-back: the platform itself tells the sender how to
      // retry, through its own guarded outbound channel (strict schema).
      const confirmBackDelivered = await sendSmsGuarded(normalizedSenderPhone, confirmUnparseable());
      return res.json({ ok: true, confirmBackDelivered });
    }

    const result = await createEmergencyRequest({ contactPhone: normalizedSenderPhone, bloodGroup, city, reason: "Emergency SOS via SMS" });

    // Abuse controls (Phase 3): the same phone asking for the same blood
    // group again gets the honest answer — their open request still stands.
    if (result.duplicate) {
      const confirmBackDelivered = await sendSmsGuarded(normalizedSenderPhone, confirmDuplicateRequest(bloodGroup));
      return res.json({ ok: true, confirmBackDelivered });
    }

    if (result.error || !result.sos) {
      const confirmBackDelivered = await sendSmsGuarded(normalizedSenderPhone, confirmProcessingFailed());
      return res.json({ ok: true, confirmBackDelivered });
    }

    // Same donor alerting as the web flow: matching donors get in-app/SMS/
    // push alerts per their own preferences. Never blocks the reply.
    notifyMatchingDonors(result.sos).catch(err => {
      logger.error({ err }, "[notify] donor alert dispatch failed (SMS path)");
    });

    const count = result.sos.matchingDonorsCount;
    const confirmBackDelivered = await sendSmsGuarded(normalizedSenderPhone, confirmSosReceived(bloodGroup, count));
    res.json({ ok: true, confirmBackDelivered });
  } catch (err) {
    next(err);
  }
});

export default router;
