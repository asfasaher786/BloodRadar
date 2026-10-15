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

const problems: string[] = [];

if (isProd) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET is required in production and must be at least 32 characters (generate one: openssl rand -base64 48)");
  }
  if (!process.env.FRONTEND_URL) {
    problems.push("FRONTEND_URL is required in production (used for strict CORS and cookie security)");
  }
  if (process.env.SMS_PROVIDER === "twilio" && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER)) {
    problems.push("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER");
  }
}

failFast(problems);

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
  // of these lists. In dev only, the seeded demo admin's phone is granted
  // admin so the moderation flows can be exercised locally; production
  // starts with empty lists and requires explicit env configuration.
  ADMIN_PHONES: parsePhoneList(process.env.ADMIN_PHONES).concat(
    isProd ? [] : ["+923331234567"] // seedData demo admin (Dr. Safeer)
  ),
  STAFF_PHONES: parsePhoneList(process.env.STAFF_PHONES),
  NGO_PHONES: parsePhoneList(process.env.NGO_PHONES),
  // Reminder job gate: disabled by default in dev/test, enable with env var.
  ENABLE_DONATION_REMINDERS: process.env.ENABLE_DONATION_REMINDERS === "true",
};
