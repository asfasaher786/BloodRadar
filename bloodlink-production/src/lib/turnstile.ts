import { API_BASE } from "./api";

// P3a-7 client-side Turnstile helpers. When the server has Turnstile keys
// configured, the bot-walled endpoints (OTP request, SOS create) need a
// fresh challenge token attached to the request. When it doesn't — the
// current state — every helper here is a transparent pass-through and the
// app behaves exactly as before the feature existed.

interface TurnstileConfig {
  enabled: boolean;
  siteKey: string;
}

let cfgPromise: Promise<TurnstileConfig> | null = null;

export function getTurnstileConfig(): Promise<TurnstileConfig> {
  if (!cfgPromise) {
    cfgPromise = fetch(`${API_BASE}/api/config/public`)
      .then((res) => (res.ok ? res.json() : { turnstile: { enabled: false, siteKey: "" } }))
      .then((data) => data.turnstile as TurnstileConfig)
      .catch(() => ({ enabled: false, siteKey: "" }));
  }
  return cfgPromise;
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("cf-turnstile-script");
    if (existing) return resolve();
    const script = document.createElement("script");
    script.id = "cf-turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("Bot check could not load. Please check your connection."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

let widgetId: string | null = null;
let widgetContainer: HTMLDivElement | null = null;

function ensureWidget(siteKey: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!widgetContainer) {
      widgetContainer = document.createElement("div");
      // The widget manages its own visibility (invisible mode shows the
      // challenge as an overlay); the container itself is never visible.
      widgetContainer.style.position = "fixed";
      widgetContainer.style.left = "-9999px";
      widgetContainer.style.top = "0";
      widgetContainer.setAttribute("aria-hidden", "true");
      document.body.appendChild(widgetContainer);
    }

    if (widgetId) {
      try {
        (window as any).turnstile.reset(widgetId);
      } catch {
        widgetId = null;
        widgetContainer.innerHTML = "";
      }
    }

    const timeout = setTimeout(() => {
      reject(new Error("Bot check timed out. Please try again."));
    }, 30000);

    const finish = (token: string) => {
      clearTimeout(timeout);
      if (token) resolve(token);
      else reject(new Error("Bot check was not completed. Please try again."));
    };

    try {
      widgetId = (window as any).turnstile.render(widgetContainer, {
        sitekey: siteKey,
        size: "invisible",
        callback: finish,
        "error-callback": () => finish(""),
        "expired-callback": () => finish(""),
      });
      (window as any).turnstile.execute(widgetId);
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/** A fresh, single-use token — or "" when the bot wall is off. */
async function getFreshToken(): Promise<string> {
  const cfg = await getTurnstileConfig();
  if (!cfg.enabled) return "";
  await loadTurnstileScript();
  return ensureWidget(cfg.siteKey);
}

/**
 * POST JSON to the API, attaching a fresh Turnstile token when the server
 * has the bot wall enabled. Every bot-walled endpoint should go through
 * here instead of a raw fetch.
 */
export async function postWithBotCheck(
  url: string,
  payload: Record<string, unknown>,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getFreshToken();
  const body = token ? { ...payload, turnstileToken: token } : payload;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
    body: JSON.stringify(body),
  });
}
