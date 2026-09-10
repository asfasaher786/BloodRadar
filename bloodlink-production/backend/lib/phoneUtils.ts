import { DEFAULT_COUNTRY_CODE } from "../config/regions";

// Normalizes phone numbers so the same donor is recognized regardless of
// formatting. Real international numbers (typed with a leading "+") are
// respected as-is — we never overwrite a real country code. Only numbers
// with NO country code at all (a bare local number) fall back to
// DEFAULT_COUNTRY_CODE, since we have to assume something for local-format
// input like "0300 1234567".
export function normalizePhone(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();

  // Already has an explicit country code — trust it, whatever country it is.
  if (trimmed.startsWith("+")) {
    return "+" + trimmed.slice(1).replace(/\D/g, "");
  }

  const digits = trimmed.replace(/\D/g, "");

  // Looks like it already includes DEFAULT_COUNTRY_CODE without a "+"
  // (e.g. "923001234567")
  if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length === DEFAULT_COUNTRY_CODE.length + 10) {
    return "+" + digits;
  }
  // Local format starting with a trunk "0" (e.g. "03001234567")
  if (digits.startsWith("0") && digits.length === 11) {
    return "+" + DEFAULT_COUNTRY_CODE + digits.slice(1);
  }
  // Bare 10-digit number with no country code or trunk prefix at all
  if (digits.length === 10) {
    return "+" + DEFAULT_COUNTRY_CODE + digits;
  }
  // Doesn't match a known pattern — return as-is rather than guessing wrong.
  return trimmed;
}
