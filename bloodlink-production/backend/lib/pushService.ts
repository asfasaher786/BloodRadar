import webpush from "web-push";
import { CONFIG } from "../config/config";

// Web push delivery (VAPID). Push is a best-effort channel: it only runs
// when the operator has configured VAPID_* env keys, and a failing or
// expired subscription is removed rather than retried forever. Nothing here
// ever throws into the SOS-create path — the caller treats push as
// optional by design.

export interface PushSendResult {
  ok: boolean;
  /** The subscription no longer exists (unsubscribed/browser gone). */
  gone: boolean;
}

export function pushConfigured(): boolean {
  return CONFIG.PUSH_ENABLED;
}

function vapidDetails() {
  return {
    subject: CONFIG.VAPID_SUBJECT,
    publicKey: CONFIG.VAPID_PUBLIC_KEY,
    privateKey: CONFIG.VAPID_PRIVATE_KEY,
  };
}

export async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: object
): Promise<PushSendResult> {
  if (!pushConfigured()) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: vapidDetails(),
      TTL: 300, // alerts are only useful for a few minutes
    });
    return { ok: true, gone: false };
  } catch (err: any) {
    const status = err?.statusCode || 0;
    if (status === 404 || status === 410) {
      return { ok: false, gone: true };
    }
    console.error("[push] send failed:", status || err?.message || err);
    return { ok: false, gone: false };
  }
}
