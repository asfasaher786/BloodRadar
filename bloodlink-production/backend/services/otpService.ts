import crypto from "crypto";
import { CONFIG } from "../config/config";
import { getDb } from "./dbService";
import { getSmsProvider } from "../lib/smsProvider";

// OTP lifecycle. Rules:
//  - 6-digit code, hashed at rest (sha256 + per-code salt) — the plaintext
//    code exists only in memory for the instant it is generated and is
//    handed to the SMS provider (or printed by the console provider in dev).
//  - 5-minute expiry, maximum 5 verification attempts.
//  - Per-phone cooldown (60s between sends) and daily cap (10).
//  - The code is NEVER returned in an API response in production and is
//    never written to logs in production.

const OTP_REQUEST_COOLDOWN_MS = 60 * 1000;
const OTP_DAILY_CAP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

interface OtpRecord {
  phone: string;
  hash: string;
  salt: string;
  attempts: number;
  expiresAt: number;
  // Date twin of expiresAt, used by the Mongo TTL index (TTL needs a Date).
  expiresAtDate: Date;
  lastSentAt: number;
  sentToday: number;
  dayKey: string;
}

function hashOtp(code: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function dayKeyFor(now: number): string {
  return new Date(now).toISOString().split("T")[0];
}

// In-memory fallback store (dev / no Mongo)
const memoryOtps = new Map<string, OtpRecord>();

async function getRecord(phone: string): Promise<OtpRecord | null> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return (await db.collection("otps").findOne({ phone })) as unknown as OtpRecord | null;
  }
  return memoryOtps.get(phone) || null;
}

async function putRecord(record: OtpRecord): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("otps").updateOne({ phone: record.phone }, { $set: record }, { upsert: true });
    return;
  }
  memoryOtps.set(record.phone, record);
}

async function deleteRecord(phone: string): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("otps").deleteOne({ phone });
    return;
  }
  memoryOtps.delete(phone);
}

export type OtpSendResult =
  | { ok: true; devOtp?: string }
  | { ok: false; error: string };

export async function sendOtpToPhone(phone: string): Promise<OtpSendResult> {
  const now = Date.now();
  const existing = await getRecord(phone);

  if (existing) {
    // Expired records don't block re-sending, but a live one enforces cooldown.
    if (now < existing.expiresAt && now - existing.lastSentAt < OTP_REQUEST_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_REQUEST_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
      return { ok: false, error: `Please wait ${waitSeconds}s before requesting another code.` };
    }
    if (existing.dayKey === dayKeyFor(now) && existing.sentToday >= OTP_DAILY_CAP) {
      return { ok: false, error: "Daily code limit reached. Please try again tomorrow." };
    }
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const salt = crypto.randomBytes(8).toString("hex");

  const record: OtpRecord = {
    phone,
    hash: hashOtp(code, salt),
    salt,
    attempts: 0,
    expiresAt: now + CONFIG.OTP_TTL_MS,
    expiresAtDate: new Date(now + CONFIG.OTP_TTL_MS),
    lastSentAt: now,
    sentToday: existing && existing.dayKey === dayKeyFor(now) ? existing.sentToday + 1 : 1,
    dayKey: dayKeyFor(now),
  };
  await putRecord(record);

  // Deliver through the configured SMS provider. The console provider
  // prints the code server-side (dev only by default).
  const provider = getSmsProvider();
  const delivered = await provider.sendSms(phone, `Your BloodRadar verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`);
  if (!delivered) {
    return { ok: false, error: "Failed to send the code through the SMS provider. Please try again." };
  }

  // In non-production the UI shows a "Test mode" hint; production never sees it.
  return CONFIG.IS_PROD ? { ok: true } : { ok: true, devOtp: code };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; error: string };

export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
  const record = await getRecord(phone);
  if (!record) return { ok: false, error: "No active code for this number. Please request a new one." };

  if (Date.now() > record.expiresAt) {
    await deleteRecord(phone);
    return { ok: false, error: "This code has expired. Please request a new one." };
  }

  if (record.attempts >= CONFIG.OTP_MAX_ATTEMPTS) {
    await deleteRecord(phone);
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  const match = crypto.timingSafeEqual(Buffer.from(hashOtp(code, record.salt)), Buffer.from(record.hash));
  if (!match) {
    record.attempts += 1;
    await putRecord(record);
    const remaining = CONFIG.OTP_MAX_ATTEMPTS - record.attempts;
    return { ok: false, error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` };
  }

  await deleteRecord(phone);
  return { ok: true };
}
