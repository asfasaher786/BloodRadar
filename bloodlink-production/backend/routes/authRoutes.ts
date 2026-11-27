import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { CONFIG } from "../config/config";
import { normalizePhone } from "../lib/phoneUtils";
import { sanitizeText } from "../lib/sanitize";
import { sendOtpToPhone, verifyOtp } from "../services/otpService";
import {
  addAuditLog,
  addDonor,
  consumeAdminRecoveryCode,
  deleteDonorAccount,
  getAdminSecurity,
  getDonorByPhone,
  computeNextEligibleDate,
  getApprovedOrganizationForPhone,
  trackAdminDevice,
} from "../services/dbService";
import { verifyTotp, hashRecoveryCode } from "../lib/totp";
import { sendSmsGuarded } from "../lib/smsProvider";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenByJti,
  revokeAllRefreshTokensForSub,
} from "../services/refreshTokenStore";
import { resolveCity, getCityCenter } from "../config/regions";
import { resolveNeighbourhood } from "../config/neighbourhoods";
import {
  AUTH_COOKIE_NAMES,
  cookieOptions,
  Role,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens";
import { authMiddleware } from "../middleware/auth";
import { verifyTurnstile } from "../lib/turnstile";
import { testNameBlockReason } from "../lib/sosFlags";

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

// P3b-10: the privacy policy version a donor consents to at registration.
// Bumping it (after a real policy change) means new registrations record the
// new version; the UI checkbox links to the live #privacy page.
export const PRIVACY_POLICY_VERSION = "1.0";

const requestOtpSchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20, "Phone number looks too long"),
  // P3a-7: optional Turnstile token. Required only when TURNSTILE keys are
  // configured server-side; otherwise ignored.
  turnstileToken: z.string().trim().max(2048).optional(),
});

const verifyOtpSchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20),
  code: z.string().trim().refine((c) => /^\d{6}$/.test(c), "Code must be exactly 6 digits"),
  registerAsDonor: z.boolean().optional(),
  // P3b-10: registration requires an explicit privacy-policy consent. The
  // backend records the version + timestamp on the donor record so consent
  // is auditable, not just asserted.
  privacyConsent: z.boolean().optional(),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60).optional(),
  bloodGroup: z.string().trim().regex(BLOOD_GROUP_RE, "Blood group must look like A+, B-, O+").optional(),
  city: z.string().trim().max(50).optional(),
  location: z.string().trim().max(120).optional(),
  // P2-4: consented coarse location — a neighbourhood picked from the list.
  area: z.string().trim().max(80).optional(),
});

// P3a-8: 6-digit app code or a dashed recovery code (e.g. 1234-5678-9012).
const totpVerifySchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20),
  code: z.string().trim().min(6, "Enter the code from your authenticator app").max(24),
});

// Staff roles are granted to OTP-verified phones listed in env config —
// a verified phone is a real identity; a hardcoded token is not.
function resolveRoleForPhone(phone: string): Role {
  if (CONFIG.ADMIN_PHONES.includes(phone)) return "admin";
  if (CONFIG.STAFF_PHONES.includes(phone)) return "hospital_staff";
  if (CONFIG.NGO_PHONES.includes(phone)) return "ngo";
  return "donor";
}

// Organization portal (Phase 3): an approved org record is a real account —
// its owner's verified phone resolves to the org role at login. Env phone
// lists stay the bootstrap for the first admins; org records are the
// scalable path (admin approves, founder doesn't redeploy for each org).
async function resolveRoleForPhoneWithOrgs(phone: string): Promise<Role> {
  const envRole = resolveRoleForPhone(phone);
  if (envRole !== "donor") return envRole;
  const org = await getApprovedOrganizationForPhone(phone);
  if (org) {
    return org.type === "hospital" ? "hospital_staff" : "ngo";
  }
  return "donor";
}

// P2-8: every refresh token is registered server-side under its jti, so it
// can be rotated on use and revoked on logout or theft.
async function setAuthCookies(res: any, phone: string, role: Role): Promise<void> {
  const accessToken = signAccessToken({ sub: phone, phone, role });
  const refreshRow = await issueRefreshToken(phone);
  const refreshToken = signRefreshToken({ sub: phone, role, jti: refreshRow.jti });
  res.cookie(AUTH_COOKIE_NAMES.access, accessToken, cookieOptions(CONFIG.ACCESS_TOKEN_TTL_SECONDS));
  res.cookie(AUTH_COOKIE_NAMES.refresh, refreshToken, cookieOptions(CONFIG.REFRESH_TOKEN_TTL_SECONDS));
}

// P3a-8: the second step of an admin sign-in. After the phone OTP checks
// out, a TOTP-enabled admin must also present an authenticator-app code (or
// a recovery code) before any session cookie exists. This pending entry is
// the server-side memory of "phone OTP was just verified for this number",
// so /totp/verify can't be called cold for someone else's phone. Per-process
// with a 5-minute expiry — correct for the single Render instance.
const pendingTotp = new Map<string, number>(); // phone → expiresAt (ms)
const TOTP_PENDING_TTL_MS = 5 * 60 * 1000;

// P3a-8 new-device alert: records the device-id cookie against the admin's
// phone and, on the FIRST sign-in from a device, audit-logs it and sends the
// admin an SMS heads-up (delivered once the live gateway is configured; in
// dev the console provider prints it server-side).
async function trackAdminDeviceAndAlert(phone: string, req: any): Promise<void> {
  const deviceId = req.cookies?.br_devid || "unknown-device";
  const label = String(req.headers["user-agent"] || "unknown browser").slice(0, 120);
  const { isNew } = await trackAdminDevice(phone, deviceId, label);
  if (!isNew) return;
  await addAuditLog({
    action: "admin_new_device",
    actor: phone,
    detail: `sign-in from a new device (${deviceId.slice(0, 8)}…) — ${label}`,
  });
  const when = new Date().toISOString().replace("T", " ").slice(0, 16);
  await sendSmsGuarded(
    phone,
    `BloodRadar admin: new sign-in at ${when} (UTC) from ${label}. If this wasn't you, sign in and check the Security tab, or use a recovery code.`
  );
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

    // P3a-7: when Turnstile is enabled, an unsolved challenge means "no
    // SMS for you" — before any OTP state is touched.
    if (!(await verifyTurnstile(parsed.data.turnstileToken, req.ip || ""))) {
      return res.status(400).json({ error: "Bot check failed. Please retry." });
    }

    const result = await sendOtpToPhone(phone);
    if (result.ok === false) {
      // Cooldown/cap/send failures are client-actionable; 429 signals "slow down".
      return res.status(429).json({ error: result.error });
    }

    // devOtp exists ONLY when ALLOW_DEV_AUTH_SHORTCUTS is explicitly on
    // (dev/test opt-in, P0-2). The UI renders it inside a clearly-labelled
    // test-mode hint. Production responses never contain the code — ever.
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
    const { code, registerAsDonor, privacyConsent, name, bloodGroup, city, location, area } = parsed.data;
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
      // P3b-10: no donor record without recorded consent to the privacy
      // policy. The checkbox in the onboarding stepper is what flips this.
      if (!privacyConsent) {
        return res.status(400).json({ error: "Please review and accept the privacy policy to register." });
      }
      // P3b-8: production rejects test-like names outright so demo rows can
      // never pollute the public registry. Dev/test keep the shortcut for
      // E2E and QA flows.
      if (CONFIG.IS_PROD) {
        const blockReason = testNameBlockReason(name);
        if (blockReason) {
          return res.status(400).json({ error: "That name looks like a test entry — please enter your real name." });
        }
      }
      const donorCity = resolveCity(city || undefined);
      const center = getCityCenter(donorCity);
      // P2-4: the neighbourhood dropdown is the consented coarse location.
      // Its centroid replaces "city centre + random noise" for real
      // distance-based matching; unknown values fall back to the centre.
      const areaInput = sanitizeText(area || "", 80);
      const neighbourhood = areaInput ? resolveNeighbourhood(donorCity, areaInput) : null;
      const areaName = neighbourhood ? neighbourhood.name : (areaInput || "City Central");
      donor = {
        id: "dnr-" + crypto.randomUUID(),
        name: sanitizeText(name, 60),
        bloodGroup,
        phone,
        city: donorCity,
        area: areaName,
        location: sanitizeText(location || "", 120) || areaName,
        latitude: neighbourhood ? neighbourhood.latitude : center.latitude + (Math.random() - 0.5) * 0.05,
        longitude: neighbourhood ? neighbourhood.longitude : center.longitude + (Math.random() - 0.5) * 0.05,
        isAvailable: true,
        isVerified: true,
        stats: { donationsCount: 0, streakCount: 0, livesSaved: 0 },
        badges: [],
        notificationsOptOut: false,
        // P3b-10: recorded consent — version + timestamp — so the registry
        // can prove WHEN each donor agreed and to WHAT.
        consent: { version: PRIVACY_POLICY_VERSION, at: new Date().toISOString() },
        createdAt: new Date().toISOString(),
      };
      await addDonor(donor);
    }

    const role = await resolveRoleForPhoneWithOrgs(phone);

    // P3a-8: an admin with two-step verification enabled gets NO session
    // cookie from the phone OTP alone. The next step is /totp/verify.
    if (role === "admin") {
      const sec = await getAdminSecurity(phone);
      if (sec?.totpEnabled) {
        pendingTotp.set(phone, Date.now() + TOTP_PENDING_TTL_MS);
        return res.status(403).json({
          error: "Enter the 6-digit code from your authenticator app to finish signing in.",
          code: "TOTP_REQUIRED",
        });
      }
    }

    await setAuthCookies(res, phone, role);
    if (role === "admin") await trackAdminDeviceAndAlert(phone, req);

    res.json({ success: true, user: { phone, role, donor: enrichDonor(donor) } });
  } catch (err) {
    next(err);
  }
});

// P3a-8 second step: finish an admin sign-in with a TOTP code or a one-time
// recovery code. The phone OTP step must have run first (pendingTotp).
router.post("/totp/verify", async (req, res, next) => {
  try {
    const parsed = totpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    }
    const phone = normalizePhone(parsed.data.phone);
    const code = parsed.data.code.replace(/[\s-]/g, "");

    const expiresAt = pendingTotp.get(phone);
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(403).json({ error: "Your phone-code step expired. Please log in again." });
    }

    const sec = await getAdminSecurity(phone);
    if (!sec?.totpEnabled || !sec.totpSecret) {
      return res.status(403).json({ error: "Two-step verification is not set up for this account." });
    }

    let ok = false;
    if (/^\d{6}$/.test(code)) {
      ok = verifyTotp(sec.totpSecret, code);
    } else {
      // Recovery code: one-time use, hash-compared, consumed on success.
      const hash = hashRecoveryCode(code);
      if ((sec.recoveryCodeHashes || []).includes(hash)) {
        ok = true;
        await consumeAdminRecoveryCode(phone, hash);
        await addAuditLog({ action: "admin_recovery_code_used", actor: phone });
      }
    }

    if (!ok) {
      return res.status(400).json({ error: "That code didn't match. Try the next code from your app." });
    }

    pendingTotp.delete(phone);
    const role: Role = "admin";
    await setAuthCookies(res, phone, role);
    await trackAdminDeviceAndAlert(phone, req);
    const donor = await getDonorByPhone(phone);
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
      res.clearCookie(AUTH_COOKIE_NAMES.access, { path: "/" });
      res.clearCookie(AUTH_COOKIE_NAMES.refresh, { path: "/" });
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    // P2-8: consume the presented token; rotation issues a brand-new one.
    // A replay of an already-rotated token revokes the session family.
    const rotated = await rotateRefreshToken(payload.jti, payload.sub);
    if (!rotated.ok) {
      res.clearCookie(AUTH_COOKIE_NAMES.access, { path: "/" });
      res.clearCookie(AUTH_COOKIE_NAMES.refresh, { path: "/" });
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    const donor = await getDonorByPhone(payload.sub);
    const role = await resolveRoleForPhoneWithOrgs(payload.sub);
    await setAuthCookies(res, payload.sub, role);
    res.json({ success: true, user: { phone: payload.sub, role, donor: enrichDonor(donor) } });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    // P2-8: revoke the refresh token server-side, not just in the browser.
    // A stolen cookie can no longer mint sessions after logout.
    const token = req.cookies?.[AUTH_COOKIE_NAMES.refresh];
    if (token) {
      const payload = verifyRefreshToken(token);
      if (payload) await revokeRefreshTokenByJti(payload.jti);
    }
  } catch (err) {
    next(err);
  }
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

// P3b-10 delete-my-data: a signed-in donor can erase their profile, inbox
// history and notifications permanently. The endpoint refuses while a
// contact handoff is in flight, revokes every session (all devices), and
// audit-logs the deletion. Org-linked and admin accounts are excluded —
// those identities belong to organizations, not just the person.
router.delete("/me", authMiddleware, async (req, res, next) => {
  try {
    const phone = req.auth!.sub;
    if (req.auth!.role !== "donor") {
      return res.status(403).json({ error: "This account is linked to an organization. Contact the platform admin to make account changes." });
    }
    const result = await deleteDonorAccount(phone);
    if ("error" in result) {
      const status = result.code === "ACTIVE_CONTACT" ? 409 : 400;
      return res.status(status).json({ error: result.error });
    }
    await revokeAllRefreshTokensForSub(phone);
    await addAuditLog({
      action: "account_deleted_by_user",
      actor: phone,
      detail: "Donor deleted their own account and data (delete-my-data)",
    });
    res.clearCookie(AUTH_COOKIE_NAMES.access, { path: "/" });
    res.clearCookie(AUTH_COOKIE_NAMES.refresh, { path: "/" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
