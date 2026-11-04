import dotenv from "dotenv";
import { normalizePhone } from "../lib/phoneUtils";

// Load env variables
dotenv.config();

// Fail-fast environment validation: the server must refuse to boot in
// production with missing critical configuration, instead of silently
// degrading into insecure defaults (e.g. a hardcoded JWT secret).
function failFast(problems: string[]): void {
  if (problems.length > 0) {
    const msg = "BloodRadar refused to start — invalid environment configuration:\n  - " + problems.join("\n  - ");
    console.error(msg);
    throw new Error(msg);
  }
}

// Parses comma-separated env phone lists into canonical +CC numbers so role
// lookups compare apples to apples with normalized OTP-verified numbers.
function parsePhoneList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => normalizePhone(s))
    .filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

// P0-2: dev auth shortcuts (test-mode OTP hints in API responses, demo
// admin phone auto-grant) are OFF unless the operator explicitly opts in.
// Being non-production is NOT enough on its own — a misconfigured prod
// deploy running with NODE_ENV unset would otherwise leak dev shortcuts.
const devAuthShortcuts = !isProd && process.env.ALLOW_DEV_AUTH_SHORTCUTS === "true";

const problems: string[] = [];

if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET is required in production and must be at least 32 characters (generate one: openssl rand -base64 48)");
  }
  if (!process.env.FRONTEND_URL) {
    problems.push("FRONTEND_URL is required in production (used for strict CORS and cookie security)");
  }
  // P0-4: production must never silently serve from the in-memory store —
  // a deploy that lost its MONGO_URI would otherwise boot with zero real
  // data. The vitest runner is exempt so prod-mode behaviour can be tested.
  if (!process.env.MONGO_URI && process.env.VITEST !== "true") {
    problems.push("MONGO_URI is required in production — the in-memory fallback is for development only.");
  }
  if (process.env.SMS_PROVIDER === "twilio" && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER)) {
    problems.push("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER");
  }
}

failFast(problems);

if (isProd && !process.env.SMS_WEBHOOK_SECRET) {
  console.warn(
    "[SMS] WARNING: SMS_WEBHOOK_SECRET is not set — /api/sms/incoming accepts unauthenticated calls. Set it and configure your gateway to send it as the x-webhook-secret header (or Authorization: Bearer)."
  );
}

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV,
  IS_PROD: isProd,
  IS_TEST: NODE_ENV === "test",
  MONGO_URI: process.env.MONGO_URI || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  BACKEND_URL: process.env.BACKEND_URL || "",
  // Auth
  JWT_SECRET: process.env.JWT_SECRET || "dev-only-insecure-secret-change-me-0123456789",
  ACCESS_TOKEN_TTL_SECONDS: 15 * 60, // 15 minutes
  REFRESH_TOKEN_TTL_SECONDS: 7 * 24 * 60 * 60, // 7 days
  OTP_TTL_MS: 5 * 60 * 1000, // 5 minutes
  OTP_MAX_ATTEMPTS: 5,
  // SMS provider abstraction: "console" in dev (code printed server-side),
  // "twilio" or "custom-gateway" in production. Selected by env var.
  SMS_PROVIDER: process.env.SMS_PROVIDER || (isProd ? "console" : "console"),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || "",
  // Default country code used when a phone number has no international prefix.
  // Configurable so a deployment in another country doesn't require code edits.
  DEFAULT_COUNTRY_CODE: process.env.COUNTRY_CODE || "92",
  // OTP-verified phone numbers granted elevated roles (comma-separated env
  // lists). Roles are assigned at login when the verified phone matches one
  // of these lists. With ALLOW_DEV_AUTH_SHORTCUTS=true in dev only, the
  // seeded demo admin's phone is also granted admin so the moderation flows
  // can be exercised locally; production (and dev without the flag) starts
  // with empty lists and requires explicit env configuration.
  ADMIN_PHONES: parsePhoneList(process.env.ADMIN_PHONES).concat(
    devAuthShortcuts ? ["+923331234567"] : [] // seedData demo admin (Dr. Safeer)
  ),
  STAFF_PHONES: parsePhoneList(process.env.STAFF_PHONES),
  NGO_PHONES: parsePhoneList(process.env.NGO_PHONES),
  // P0-2: dev-only auth shortcuts gate. True only when NODE_ENV is not
  // production AND the operator set ALLOW_DEV_AUTH_SHORTCUTS=true.
  ALLOW_DEV_AUTH_SHORTCUTS: devAuthShortcuts,
  // Reminder job gate: disabled by default in dev/test, enable with env var.
  ENABLE_DONATION_REMINDERS: process.env.ENABLE_DONATION_REMINDERS === "true",
  // Web push (VAPID). All three keys must be present for push to work;
  // missing keys degrade honestly (the UI says "not configured", the server
  // skips push silently) instead of crashing or pretending to deliver.
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || "",
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || "",
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || "",
  PUSH_ENABLED: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT),
  // Quiet hours are evaluated in this timezone. Defaults to Pakistan time;
  // a white-label deployment sets NOTIFICATION_TZ to its own IANA zone.
  NOTIFICATION_TZ: process.env.NOTIFICATION_TZ || "Asia/Karachi",
  // Shared secret the SMS gateway must send on the incoming webhook
  // (x-webhook-secret header or Authorization: Bearer). When set, calls
  // without it are rejected; when unset, the webhook is open (dev default)
  // and production logs a warning at boot.
  SMS_WEBHOOK_SECRET: process.env.SMS_WEBHOOK_SECRET || "",
};
