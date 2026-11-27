import { CONFIG } from "../config/config";
import { logger } from "./logger";

// SMS provider abstraction. Swappable without touching route logic: a real
// production deployment selects its provider via the SMS_PROVIDER env var.
// The console provider is the honest dev default (code printed server-side,
// never returned by the API), so the whole OTP flow works end-to-end
// locally without any external account.
export interface SmsProvider {
  readonly name: string;
  /** @returns true if the message was dispatched (or printed, in console mode) */
  sendSms(to: string, body: string): Promise<boolean>;
}

class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async sendSms(to: string, body: string): Promise<boolean> {
    // P3a-1: OTP bodies must never land in production logs. In development,
    // printing is the delivery mechanism (devOtp is also shown in the UI).
    // In production the ONLY code ever printed is for the operator's own
    // admin phone — the interim log-OTP admin sign-in (see DEPLOYMENT-
    // RUNBOOK § smoke). Real users' OTPs are never logged, in any env pair.
    const isAdminPhone = CONFIG.ADMIN_PHONES.includes(to);
    if (!CONFIG.IS_PROD || isAdminPhone) {
      console.log(`[SMS:console] to=${to} body=${body}`);
    }
    return true;
  }
}

// Twilio via their REST API (no heavy SDK dependency). Requires
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  async sendSms(to: string, body: string): Promise<boolean> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.TWILIO_ACCOUNT_SID}/Messages.json`;
      const form = new URLSearchParams();
      form.set("To", to);
      form.set("From", CONFIG.TWILIO_FROM_NUMBER);
      form.set("Body", body);

      const auth = Buffer.from(`${CONFIG.TWILIO_ACCOUNT_SID}:${CONFIG.TWILIO_AUTH_TOKEN}`).toString("base64");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      if (!response.ok) {
        logger.error(`[SMS:twilio] send failed with HTTP ${response.status}: ${await response.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.error({ err }, "[SMS:twilio] send threw");
      return false;
    }
  }
}

// Generic HTTP gateway hook for local Pakistani/other-country SMS providers
// that expose a simple REST endpoint. Configure via env: SMS_GATEWAY_URL,
// optional SMS_GATEWAY_API_KEY. The request body is { to, text } as JSON.
class CustomGatewaySmsProvider implements SmsProvider {
  readonly name = "custom-gateway";
  async sendSms(to: string, body: string): Promise<boolean> {
    const url = process.env.SMS_GATEWAY_URL;
    if (!url) {
      logger.error("[SMS:custom-gateway] SMS_GATEWAY_URL not set");
      return false;
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.SMS_GATEWAY_API_KEY ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_API_KEY}` } : {}),
        },
        body: JSON.stringify({ to, text: body }),
      });
      if (!response.ok) {
        logger.error(`[SMS:custom-gateway] send failed with HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.error({ err }, "[SMS:custom-gateway] send threw");
      return false;
    }
  }
}

let provider: SmsProvider | null = null;

/** P0-6: donor SMS alerts stay gated off until a live provider is connected.
 * "console" only prints to server logs — it must never be presented as a
 * working delivery channel to donors. OTP codes are a separate concern and
 * keep using the console provider in development. */
export function hasLiveSmsProvider(): boolean {
  return CONFIG.SMS_PROVIDER !== "console";
}

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;
  switch (CONFIG.SMS_PROVIDER) {
    case "twilio":
      provider = new TwilioSmsProvider();
      break;
    case "custom-gateway":
      provider = new CustomGatewaySmsProvider();
      break;
    default:
      provider = new ConsoleSmsProvider();
  }
  if (CONFIG.IS_PROD && provider.name === "console") {
    logger.warn("[SMS] WARNING: SMS_PROVIDER=console in production — OTP codes are only printed to server logs (admin phones only), not delivered. Set SMS_PROVIDER=twilio or custom-gateway with credentials.");
  }
  return provider;
}

// ---------------------------------------------------------------------------
// P3a-7 SMS-pumping defences. Every outbound SMS must pass through
// sendSmsGuarded() — the single choke point that applies the country
// allow-list and the global daily spend cap before money can leave.
// ---------------------------------------------------------------------------

/** Country allow-list: the number must start with one of the configured
 * prefixes (default +92 — this deployment serves Pakistan). */
export function isPhoneAllowedForSms(phone: string): boolean {
  return CONFIG.SMS_ALLOWED_PREFIXES.some(prefix => phone.startsWith(prefix));
}

export interface SmsSpendState {
  dayKey: string;
  sentToday: number;
  alerted70: boolean;
  alerted100: boolean;
}

// Module state: the cap is a per-process, per-UTC-day counter. BloodRadar
// runs as a single Render instance, so one process == the whole deployment.
// (A horizontally-scaled future deployment must move this into Mongo.)
export const smsSpend: SmsSpendState = { dayKey: "", sentToday: 0, alerted70: false, alerted100: false };

/** Resets the day counter when the UTC day rolls over. Exported for tests. */
export function rollSmsSpendDay(now: number): void {
  const dayKey = new Date(now).toISOString().split("T")[0];
  if (smsSpend.dayKey !== dayKey) {
    smsSpend.dayKey = dayKey;
    smsSpend.sentToday = 0;
    smsSpend.alerted70 = false;
    smsSpend.alerted100 = false;
  }
}

export function getSmsSendStats() {
  return {
    sentToday: smsSpend.sentToday,
    dailyCap: CONFIG.SMS_GLOBAL_DAILY_CAP,
    remaining: Math.max(0, CONFIG.SMS_GLOBAL_DAILY_CAP - smsSpend.sentToday),
  };
}

/**
 * The one legal way to send an SMS. Applies, in order:
 *  1. the country allow-list (refuse foreign numbers before any spend);
 *  2. the global daily cap (refuse once today's budget is exhausted);
 *  3. the underlying provider (real gateway, or console in dev).
 * Spend alerts (70% and 100% of the cap) are logged and audit-logged once
 * per UTC day so the founder sees a runaway bill before it becomes one.
 */
export async function sendSmsGuarded(to: string, body: string): Promise<boolean> {
  if (!isPhoneAllowedForSms(to)) {
    logger.warn(`[SMS-guard] refused send to ${to} — number not in SMS_ALLOWED_PREFIXES`);
    return false;
  }

  // The cap only gates LIVE providers: in dev the console provider costs
  // nothing, and the E2E suite legitimately sends many codes.
  if (hasLiveSmsProvider()) {
    rollSmsSpendDay(Date.now());
    if (smsSpend.sentToday >= CONFIG.SMS_GLOBAL_DAILY_CAP) {
      if (!smsSpend.alerted100) {
        smsSpend.alerted100 = true;
        logger.error(`[SMS-guard] GLOBAL DAILY CAP (${CONFIG.SMS_GLOBAL_DAILY_CAP}) reached — refusing further SMS sends for the rest of the UTC day.`);
        try {
          const { addAuditLog } = await import("../services/dbService");
          await addAuditLog({ action: "sms_spend_cap_reached", actor: "system", detail: `SMS daily cap ${CONFIG.SMS_GLOBAL_DAILY_CAP} reached; sends stopped until the next UTC day` });
        } catch { /* audit must never block the refusal */ }
      }
      return false;
    }
  }

  const ok = await getSmsProvider().sendSms(to, body);
  if (ok && hasLiveSmsProvider()) {
    smsSpend.sentToday += 1;
    const cap = CONFIG.SMS_GLOBAL_DAILY_CAP;
    if (!smsSpend.alerted70 && smsSpend.sentToday >= Math.floor(cap * 0.7)) {
      smsSpend.alerted70 = true;
      logger.warn(`[SMS-guard] spend alert: ${smsSpend.sentToday}/${cap} SMS sent today (70% threshold crossed).`);
      try {
        const { addAuditLog } = await import("../services/dbService");
        await addAuditLog({ action: "sms_spend_70_percent", actor: "system", detail: `${smsSpend.sentToday}/${cap} SMS sent today` });
      } catch { /* audit must never block delivery */ }
    }
    if (!smsSpend.alerted100 && smsSpend.sentToday >= cap) {
      smsSpend.alerted100 = true;
      logger.error(`[SMS-guard] spend alert: daily cap ${cap} just reached — all further sends refused today.`);
    }
  }
  return ok;
}

/** Only for tests: reset the spend tracker so assertions start clean. */
export function __resetSmsSpendForTest(): void {
  smsSpend.dayKey = "";
  smsSpend.sentToday = 0;
  smsSpend.alerted70 = false;
  smsSpend.alerted100 = false;
}
