import { z } from "zod";

// P3b-2: every SMS the platform sends back to an inbound sender follows a
// strict schema — plain text, no markdown, short enough for a single SMS
// segment (160 chars, GSM-7). Fixed templates only: confirmation texts are
// deterministic so gateways, tests, and human operators can rely on their
// exact shape. Confirm-backs go out through the platform's own guarded
// outbound channel (sendSmsGuarded), never through the gateway's HTTP
// response, because gateways disagree on whether they pass replies through
// (Twilio ignores JSON entirely).

export const MAX_CONFIRM_LENGTH = 160;

export const smsConfirmBackSchema = z.object({
  to: z.string().min(7).max(20),
  text: z.string().min(1).max(MAX_CONFIRM_LENGTH),
});

// Markdown/formatting characters that have no business in an SMS.
const FORBIDDEN_FORMATTING = /[*_#`[\]]/;

function build(text: string): string {
  if (text.length > MAX_CONFIRM_LENGTH) {
    throw new Error(`SMS confirm-back exceeds ${MAX_CONFIRM_LENGTH} chars: ${text}`);
  }
  if (FORBIDDEN_FORMATTING.test(text)) {
    throw new Error(`SMS confirm-back contains formatting characters: ${text}`);
  }
  return text;
}

export function confirmSosReceived(bloodGroup: string, donorCount: number): string {
  return donorCount > 0
    ? build(`BloodRadar: ${bloodGroup} request received. ${donorCount} compatible donor(s) nearby have been alerted. Stay by your phone.`)
    : build(`BloodRadar: ${bloodGroup} request received, but no matching donors are listed nearby yet. Please also call the hospital directly.`);
}

export function confirmDuplicateRequest(bloodGroup: string): string {
  return build(`BloodRadar: we already have your open ${bloodGroup} request - no need to send it again. Donors are still being matched.`);
}

export function confirmUnparseable(): string {
  return build(`BloodRadar: we couldn't read your blood group. Text your group and city, e.g. O+ ISLAMABAD.`);
}

export function confirmProcessingFailed(): string {
  return build(`BloodRadar: we couldn't process your request right now. Please call the nearest hospital directly if this is urgent.`);
}
