import { CONFIG } from "../config/config";
import { logger } from "./logger";

// P3a-7 bot protection (optional). Cloudflare Turnstile is free and sits
// between scripts and the OTP/SOS endpoints: a solved challenge proves a
// human made the request, which is what stops SMS-pumping at the source.
// It is strictly opt-in — until the founder configures TURNSTILE_SITE_KEY
// and TURNSTILE_SECRET_KEY, every check passes and the frontend shows no
// widget, so behaviour is identical to before the feature existed.

export function turnstileEnabled(): boolean {
  return CONFIG.TURNSTILE_ENABLED;
}

/**
 * Verifies a Turnstile token with Cloudflare. When Turnstile is not
 * configured this always resolves true (feature off). A failed network
 * call resolves false — never fail open on a bot wall.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", CONFIG.TURNSTILE_SECRET_KEY);
    form.set("response", token);
    form.set("remoteip", ip || "");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return false;
    const data: any = await response.json();
    return data.success === true;
  } catch (err) {
    logger.warn({ err }, "[turnstile] siteverify failed");
    return false;
  }
}
