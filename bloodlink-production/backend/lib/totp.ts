import crypto from "crypto";

// P3a-8: TOTP (RFC 6238) for admin two-step verification. Implemented with
// node:crypto only — no new runtime dependency, same spirit as the
// crypto.randomInt OTP upgrade (P3a-2). HMAC-SHA1, 6 digits, 30-second
// period, ±1 window of clock drift — exactly what Google Authenticator and
// every other standard app expects.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // tolerate separators/spaces
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits of entropy (20 random bytes), base32-encoded like the apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The 6-digit code the authenticator app shows at a given unix second. */
export function totpAt(secret: string, timeSeconds: number): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timeSeconds / TOTP_PERIOD_SECONDS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a code against the current, previous and next 30s windows
 * (window=1) so a code typed near a boundary never reads as "wrong".
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { window?: number; nowMs?: number } = {}
): boolean {
  const window = opts.window ?? 1;
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  for (let w = -window; w <= window; w++) {
    if (constantTimeEqual(totpAt(secret, now + w * TOTP_PERIOD_SECONDS), clean)) {
      return true;
    }
  }
  return false;
}

/** otpauth:// URI the authenticator app scans (or the admin types manually). */
export function buildOtpauthUrl(phone: string, secret: string): string {
  const label = encodeURIComponent(`BloodRadar:${phone}`);
  const issuer = encodeURIComponent("BloodRadar");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

// One-time recovery codes: the honest answer to "I lost my phone". Shown to
// the admin exactly once at enrollment; only SHA-256 hashes are stored.

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomInt(0, 10 ** 12).toString().padStart(12, "0");
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}
