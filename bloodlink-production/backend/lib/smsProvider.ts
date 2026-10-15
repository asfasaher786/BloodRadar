import { CONFIG } from "../config/config";

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
    // In development this is the OTP delivery mechanism. In production with
    // SMS_PROVIDER=console, a clear warning is emitted once at boot instead
    // of silently "sending" nothing.
    console.log(`[SMS:console] to=${to} body=${body}`);
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
        console.error(`[SMS:twilio] send failed with HTTP ${response.status}: ${await response.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SMS:twilio] send threw:", err);
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
      console.error("[SMS:custom-gateway] SMS_GATEWAY_URL not set");
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
        console.error(`[SMS:custom-gateway] send failed with HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SMS:custom-gateway] send threw:", err);
      return false;
    }
  }
}

let provider: SmsProvider | null = null;

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
    console.warn("[SMS] WARNING: SMS_PROVIDER=console in production — OTP codes are only printed to server logs, not delivered. Set SMS_PROVIDER=twilio or custom-gateway with credentials.");
  }
  return provider;
}
