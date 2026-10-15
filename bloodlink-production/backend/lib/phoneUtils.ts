import { DEFAULT_COUNTRY_CODE } from "../config/regions";

// Country code used when a phone number has no international prefix.
// Configurable via the COUNTRY_CODE env var so a deployment in another
// country (international client) works without any code edits; the static
// regions.ts value is the code-level default. Read at call time so env
// changes and dotenv loading order never matter.
function countryCode(): string {
  return process.env.COUNTRY_CODE || DEFAULT_COUNTRY_CODE;
}

// Normalizes phone numbers so the same donor is recognized regardless of
// formatting. Real international numbers (typed with a leading "+") are
// respected as-is — we never overwrite a real country code. Only numbers
// with NO country code at all (a bare local number) fall back to the
// configured country code, since we have to assume something for
// local-format input like "0300 1234567".
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const cc = countryCode();

  // Already has an explicit country code — trust it, whatever country it is.
  if (trimmed.startsWith("+")) {
    return "+" + trimmed.slice(1).replace(/\D/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");

  // Looks like it already includes the country code without a "+"
  // (e.g. "923001234567")
  if (digits.startsWith(cc) && digits.length === cc.length + 10) {
    return "+" + digits;
  }
  // Local format starting with a trunk "0" (e.g. "03001234567")
  if (digits.startsWith("0") && digits.length === 11) {
    return "+" + cc + digits.slice(1);
  }
  // Bare 10-digit number with no country code. A leading "0" is the trunk
  // prefix (e.g. UAE "0501234567") and must be stripped before adding the
  // country code — this is what makes COUNTRY_CODE configurability work for
  // non-Pakistan deployments too, not just the 11-digit Pakistani format.
  if (digits.length === 10) {
    return "+" + cc + (digits.startsWith("0") ? digits.slice(1) : digits);
  }
  // Doesn't match a known pattern — return as-is rather than guessing wrong.
  return trimmed;
}

// Privacy mask for public listings: "+923005551234" → "+92 300 •••• 234".
// Full numbers are only ever revealed through the explicit contact-reveal
// flow (donor accepts → requester and donor exchange real numbers).
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone; // too short to mask meaningfully
  const cc = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length < 6) return "+" + cc + " ••••";
  return "+" + cc + " " + rest.slice(0, 3) + " •••• " + rest.slice(-3);
}
