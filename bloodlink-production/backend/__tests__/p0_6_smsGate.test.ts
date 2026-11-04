import { describe, it, expect, afterEach, vi } from "vitest";

// P0-6: donor SMS alerts are gated on hasLiveSmsProvider(), which is true
// only when SMS_PROVIDER is a real provider (twilio / custom-gateway) and
// false for "console" (the dev/fallback that only prints to server logs).
// CONFIG is a module-level constant, so the true path needs a fresh module
// registry with the env set first.

afterEach(() => {
  delete process.env.SMS_PROVIDER;
  vi.resetModules();
});

describe("SMS-alerts gate (P0-6)", () => {
  it("flags the console provider as NOT live", async () => {
    delete process.env.SMS_PROVIDER;
    const { hasLiveSmsProvider } = await import("../lib/smsProvider");
    expect(hasLiveSmsProvider()).toBe(false);
  });

  it("flags a custom HTTP gateway as live", async () => {
    vi.resetModules();
    process.env.SMS_PROVIDER = "custom-gateway";
    const { hasLiveSmsProvider } = await import("../lib/smsProvider");
    expect(hasLiveSmsProvider()).toBe(true);
  });

  it("flags twilio as live", async () => {
    vi.resetModules();
    // config.ts only demands twilio credentials when SMS_PROVIDER=twilio,
    // so provide them to keep the boot check happy.
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC-test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_FROM_NUMBER = "+12345678901";
    try {
      const { hasLiveSmsProvider } = await import("../lib/smsProvider");
      expect(hasLiveSmsProvider()).toBe(true);
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_FROM_NUMBER;
    }
  });
});
