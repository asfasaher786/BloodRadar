import { Router } from "express";
import { z } from "zod";
import { normalizePhone } from "../lib/phoneUtils";
import { sendOtpToPhone, verifyOtp } from "../services/otpService";
import { issueProofToken } from "../services/requesterProofService";

// Requester phone proof (P0-1): the same OTP challenge as login, but for
// anonymous SOS requesters. A successful verify mints a 15-minute proof
// token the SOS form must present when creating a request. Sharing the
// otpService store means one phone has ONE cooldown across both doors —
// nobody gets extra OTP budget by hopping endpoints.

const router = Router();

const requestSchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20, "Phone number looks too long"),
});

const verifySchema = z.object({
  phone: z.string().trim().min(7, "Phone number looks too short").max(20),
  code: z.string().trim().refine((c) => /^\d{6}$/.test(c), "Code must be exactly 6 digits"),
});

router.post("/otp/request", async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "A valid phone number is required." });
    }
    const phone = normalizePhone(parsed.data.phone);

    const result = await sendOtpToPhone(phone);
    if (result.ok === false) {
      // Cooldown/cap/send failures are client-actionable; 429 signals "slow down".
      return res.status(429).json({ error: result.error });
    }

    // devOtp exists ONLY when ALLOW_DEV_AUTH_SHORTCUTS is explicitly on
    // (dev/test opt-in, P0-2). Production responses never contain the code — ever.
    res.json({ success: true, message: "Verification code sent.", ...(result.devOtp ? { devOtp: result.devOtp } : {}) });
  } catch (err) {
    next(err);
  }
});

router.post("/otp/verify", async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
    }
    const phone = normalizePhone(parsed.data.phone);

    const verified = await verifyOtp(phone, parsed.data.code);
    if (verified.ok === false) {
      return res.status(400).json({ error: verified.error });
    }

    const proof = await issueProofToken(phone);
    res.json({
      success: true,
      proofToken: proof.token,
      expiresAt: new Date(proof.expiresAt).toISOString(),
      expiresInSeconds: proof.expiresInSeconds,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
