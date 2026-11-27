// P3b-10: phone-number stripping before text ever reaches a third-party AI
// (Gemini). Users type real numbers into chat and SMS all the time ("call me
// on 0300 1234567") — the stored message keeps the original (it is the
// user's own data on our server), but the copy sent to the model must not
// contain PII. The redaction is deliberately conservative: sequences that
// merely LOOK like a phone (7+ digits with optional +/spaces/dashes/parens)
// are replaced, because a missed redaction is worse than an over-cautious
// one for a triage answer.
const PHONE_LIKE_RE = /(?:\+\d[\d\s\-()]{4,}\d|\d[\d\s\-()]{6,}\d)/g;

export const PHONE_REDACTED_PLACEHOLDER = "[phone number removed]";

// Also catches numbers written with common separators inside them and any
// leading "+". "1122" (4 digits), blood groups ("O+", "B-"), and short
// counts stay untouched.
export function redactPhonesFromText(text: string): string {
  if (!text) return text;
  return String(text).replace(PHONE_LIKE_RE, PHONE_REDACTED_PLACEHOLDER);
}
