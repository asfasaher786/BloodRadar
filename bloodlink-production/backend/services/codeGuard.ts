// P3a-5: failed requester-code attempts are throttled per IP. The code is a
// 48-bit secret (12 hex chars from crypto.randomBytes), so guessing is
// infeasible in bulk — but a modest failure budget still matters: /reveal
// hands a real donor phone number to whoever presents the code, and
// /contact-request can spam donor inboxes. The legit requester polls with
// the CORRECT code (every 15s from the frontend), so a blanket rate limit
// would punish them; failure-based throttling never does — every correct
// attempt resets the budget.

const WINDOW_MS = 10 * 60 * 1000;
export const MAX_FAILED_CODE_ATTEMPTS = 15;

interface FailureEntry {
  count: number;
  resetAt: number;
}

const failuresByIp = new Map<string, FailureEntry>();

export function noteCodeAttempt(ip: string, correct: boolean): "ok" | "blocked" {
  // Lazy prune so abandoned failure entries can't accumulate forever.
  const now = Date.now();
  for (const [key, entry] of failuresByIp) {
    if (now > entry.resetAt) failuresByIp.delete(key);
  }

  if (correct) {
    failuresByIp.delete(ip);
    return "ok";
  }

  const entry = failuresByIp.get(ip);
  if (!entry) {
    failuresByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return "ok";
  }
  entry.count += 1;
  return entry.count > MAX_FAILED_CODE_ATTEMPTS ? "blocked" : "ok";
}
