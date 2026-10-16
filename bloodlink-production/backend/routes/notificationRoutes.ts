import { Router } from "express";
import { z } from "zod";
import {
  getNotifications,
  markAllNotificationsRead,
  getNotificationsForPhone,
  markNotificationsReadForPhone,
  updateDonorNotifyPrefs,
  getDonorByPhone,
  savePushSubscription,
  removePushSubscription,
} from "../services/dbService";
import { authMiddleware } from "../middleware/auth";
import { DEFAULT_NOTIFY_PREFS, validateNotifyPrefs } from "../lib/notifyService";
import { CONFIG } from "../config/config";

const router = Router();

// The public feed stays public: only global emergency/system alerts (never
// donor-targeted rows — dbService filters those out by targetPhone).

router.get("/", async (_req, res, next) => {
  try {
    const list = await getNotifications();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/read-all", async (_req, res, next) => {
  try {
    await markAllNotificationsRead();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Donor's personal alert feed (matched-SOS notifications only).
// ---------------------------------------------------------------

router.get("/mine", authMiddleware, async (req: any, res, next) => {
  try {
    const list = await getNotificationsForPhone(req.auth.sub);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/mine/read-all", authMiddleware, async (req: any, res, next) => {
  try {
    await markNotificationsReadForPhone(req.auth.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Per-donor notification preferences (quiet hours + channels).
// ---------------------------------------------------------------

const prefsSchema = z.object({
  appAlerts: z.boolean(),
  smsAlerts: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 22:00"),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 08:00"),
  allowImmediateDuringQuiet: z.boolean(),
});

router.get("/preferences", authMiddleware, async (req: any, res, next) => {
  try {
    const donor = await getDonorByPhone(req.auth.sub);
    const prefs = validateNotifyPrefs(donor?.notifyPrefs) || { ...DEFAULT_NOTIFY_PREFS };
    res.json({
      prefs,
      timezone: CONFIG.NOTIFICATION_TZ,
      smsProvider: CONFIG.SMS_PROVIDER,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/preferences", authMiddleware, async (req: any, res, next) => {
  try {
    const parsed = prefsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid preferences" });
    }
    // A zero-length quiet window would be an accidental "never notify"
    // trap; reject it explicitly rather than storing a footgun.
    if (parsed.data.quietStart === parsed.data.quietEnd) {
      return res.status(400).json({ error: "Quiet hours start and end cannot be the same time." });
    }
    const updated = await updateDonorNotifyPrefs(req.auth.sub, parsed.data);
    if (!updated) {
      return res.status(404).json({ error: "Donor profile not found — register as a donor first." });
    }
    res.json({ success: true, prefs: parsed.data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Web push (VAPID). Subscription is per authenticated donor phone.
// /status is public and honest: when the operator hasn't configured
// VAPID keys, enabled=false and the UI shows a "not configured" state
// instead of a button that can never work.
// ---------------------------------------------------------------

router.get("/push/status", (_req, res) => {
  res.json({
    enabled: CONFIG.PUSH_ENABLED,
    // The public key is meant to be public; needed by pushManager.subscribe.
    publicKey: CONFIG.PUSH_ENABLED ? CONFIG.VAPID_PUBLIC_KEY : null,
  });
});

const subscribeSchema = z.object({
  endpoint: z.string().url("Subscription endpoint must be a valid URL"),
  keys: z.object({
    p256dh: z.string().min(16, "Missing p256dh key"),
    auth: z.string().min(16, "Missing auth key"),
  }),
});

router.post("/push/subscribe", authMiddleware, async (req: any, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid subscription" });
    }
    await savePushSubscription(req.auth.sub, {
      endpoint: parsed.data.endpoint,
      keys: parsed.data.keys,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/push/unsubscribe", authMiddleware, async (req: any, res, next) => {
  try {
    await removePushSubscription(req.auth.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
