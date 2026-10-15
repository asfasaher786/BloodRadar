// Free-text sanitization for anything a user types that we later render or
// store: strips control characters and caps length. Applied in routes, not
// in the UI, so nothing user-supplied reaches storage unwashed.

export function sanitizeText(input: string | null | undefined, maxLength = 200): string {
  if (!input) return "";
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}
