import { Router } from "express";
import { z } from "zod";
import { CONFIG } from "../config/config";
import { normalizePhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { sendOtpToPhone, verifyOtp } from "../services/otpService";
import { addDonor, getDonorByPhone, computeNextEligibleDate } from "../services/dbService";
import { resolveCity, getCityCenter } from "../config/regions";
import {
  AUTH_COOKIE_NAMES,
  cookieOptions,
  Role,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens";
import { authMiddleware } from "../middleware/auth";

// Real authentication. Replaces the old fake /login that accepted any email
// and minted a hardcoded token. Flow:
//   1. POST /otp/request  { phone }            → SMS/console code, hashed at rest
//   2. POST /otp/verify   { phone, code, ... } → sets httpOnly cookies, returns user
//   3. POST /refresh      (refresh cookie)     → new access token
//   4. POST /logout       → clears cookies
//   5. GET  /me           → authenticated identity (never users[0])
// Requesters posting an SOS stay anonymous — nothing on the SOS path
// requires these routes. They exist for donors and staff.

const router = Router();

const BLOOD_GROUP_RE = /^(A|B|AB|O)[+-]$/;

const requestOtpSchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20, "Phone number looks too long"),
});

const verifyOtpSchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20),
  code: z.string().trim().refine((c) => /^\d{6}$/.test(c), "Code must be exactly 6 digits"),
  registerAsDonor: z.boolean().optional(),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60).optional(),
  bloodGroup: z.string().trim().regex(BLOOD_GROUP_RE, "Blood group must look like A+, B-, O+").optional(),
  city: z.string().trim().max(50).optional(),
  location: z.string().trim().max(120).optional(),
});

// Staff roles are granted to OTP-verified phones listed in env config —
// a verified phone is a real identity; a hardcoded token is not.
function resolveRoleForPhone(phone: string): Role {
  if (CONFIG.ADMIN_PHONES.includes(phone)) return "admin";
  if (CONFIG.STAFF_PHONES.includes(phone)) return "hospital_staff";
  if (CONFIG.NGO_PHONES.includes(phone)) return "ngo";
  return "donor";
}

function setAuthCookies(res: any, phone: string, role: Role): void {
  const accessToken = signAccessToken({ sub: phone, phone, role });
  const refreshToken = signRefreshToken({ sub: phone, role });
  res.cookie(AUTH_COOKIE_NAMES.access, accessToken, cookieOptions(CONFIG.ACCESS_TOKEN_TTL_SECONDS));
  res.cookie(AUTH_COOKIE_NAMES.refresh, refreshToken, cookieOptions(CONFIG.REFRESH_TOKEN_TTL_SECONDS));
}

// The donor's own profile may include the 90-day eligibility date, computed
// on the fly when the record doesn't carry one yet (seeded donors).
function enrichDonor(donor: any): any {
  if (!donor) return null;
  return {
    ...donor,
    nextEligibleDate: donor.nextEligibleDate || computeNextEligibleDate(donor.lastDonationDate),
  };
}

router.post("/otp/request", async (req, res, next) => {
  try {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "A valid phone number is required." });
    }
    const phone = normalizePhone(parsed.data.phone);

    const result = await sendOtpToPhone(phone);
    if (result.ok === false) {
      // Cooldown/cap/send failures are client-actionable; 429 signals "slow down".
      return res.status(429).json({ error: result.error });
    }

    // devOtp exists ONLY outside production (console SMS provider). The UI
    // renders it inside a clearly-labelled test-mode hint. Production
    // responses never contain the code — ever.
    res.json({ success: true, message: "Verification code sent.", ...(result.devOtp ? { devOtp: result.devOtp } : {}) });
  } catch (err) {
    next(err);
  }
});

router.post("/otp/verify", async (req, res, next) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    }
    const { code, registerAsDonor, name, bloodGroup, city, location } = parsed.data;
    const phone = normalizePhone(parsed.data.phone);

    const verified = await verifyOtp(phone, code);
    if (verified.ok === false) {
      return res.status(400).json({ error: verified.error });
    }

    let donor = await getDonorByPhone(phone);

    if (!donor && registerAsDonor) {
      if (!name || !bloodGroup) {
        return res.status(400).json({ error: "Name and blood group are required to register as a donor." });
      }
      const donorCity = resolveCity(city || undefined);
      const center = getCityCenter(donorCity);
      donor = {
        id: "dnr-" + Date.now(),
        name: sanitizeText(name, 60),
        bloodGroup,
        phone,
        city: donorCity,
        location: sanitizeText(location || "", 120) || "City Central",
        latitude: center.latitude + (Math.random() - 0.5) * 0.05,
        longitude: center.longitude + (Math.random() - 0.5) * 0.05,
        isAvailable: true,
        isVerified: true,
        stats: { donationsCount: 0, streakCount: 0, livesSaved: 0 },
        badges: [],
        notificationsOptOut: false,
        createdAt: new Date().toISOString(),
      };
      await addDonor(donor);
    }

    const role = resolveRoleForPhone(phone);
    setAuthCookies(res, phone, role);

    res.json({ success: true, user: { phone, role, donor: enrichDonor(donor) } });
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAMES.refresh];
    if (!token) {
      return res.status(401).json({ error: "No active session. Please log in again." });
    }
    const payload = verifyRefreshToken(token);
    if (!payload) {
      res.clearCookie(AUTH_COOKIE_NAMES.refresh, { path: "/" });
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    const donor = await getDonorByPhone(payload.sub);
    const role = resolveRoleForPhone(payload.sub);
    setAuthCookies(res, payload.sub, role);
    res.json({ success: true, user: { phone: payload.sub, role, donor: enrichDonor(donor) } });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAMES.access, { path: "/" });
  res.clearCookie(AUTH_COOKIE_NAMES.refresh, { path: "/" });
  res.json({ success: true });
});

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const donor = await getDonorByPhone(req.auth!.sub);
    res.json({ user: { phone: req.auth!.sub, role: req.auth!.role, donor: enrichDonor(donor) } });
  } catch (err) {
    next(err);
  }
});

export default router;
