import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// P3a-7: SMS-pumping defences. Three layers, each honest about its limits:
//  1. Country allow-list — foreign numbers are refused before ANY state is
//     touched (no cooldown records, no spend, no provider call).
//  2. Global daily send cap — per-process, per-UTC-day. It gates ONLY live
//     providers; the console provider (dev/E2E) costs nothing and must
//     never be capped or the whole local test flow would break.
//  3. Cloudflare Turnstile — strictly opt-in. Absent keys = every check
//     passes and the public config endpoint reports the wall as off.
// CONFIG is a module-level constant, so env-dependent paths need a fresh
// module registry (vi.resetModules) with the env set first.

afterEach(() => {
  delete process.env.SMS_PROVIDER;
  delete process.env.SMS_GATEWAY_URL;
  delete process.env.SMS_GATEWAY_API_KEY;
  delete process.env.SMS_ALLOWED_PREFIXES;
  delete process.env.SMS_GLOBAL_DAILY_CAP;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe("country allow-list", () => {
  it("defaults to Pakistan (+92) only", async () => {
    delete process.env.SMS_ALLOWED_PREFIXES;
    const { isPhoneAllowedForSms } = await import("../lib/smsProvider");
    expect(isPhoneAllowedForSms("+923001234567")).toBe(true);
    expect(isPhoneAllowedForSms("+12025550123")).toBe(false);
    expect(isPhoneAllowedForSms("+447700900123")).toBe(false);
  });

  it("honours a configured prefix list", async () => {
    process.env.SMS_ALLOWED_PREFIXES = "+92,+971";
    const { isPhoneAllowedForSms } = await import("../lib/smsProvider");
    expect(isPhoneAllowedForSms("+923001234567")).toBe(true);
    expect(isPhoneAllowedForSms("+971501234567")).toBe(true);
    expect(isPhoneAllowedForSms("+12025550123")).toBe(false);
  });

  it("refuses a foreign number before any provider call or spend", async () => {
    process.env.SMS_PROVIDER = "custom-gateway";
    process.env.SMS_GATEWAY_URL = "https://gateway.example.test/sms";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 })) as any;
    vi.stubGlobal("fetch", fetchMock);
    const sms = await import("../lib/smsProvider");
    sms.__resetSmsSpendForTest();

    expect(await sms.sendSmsGuarded("+12025550123", "hi")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sms.smsSpend.sentToday).toBe(0);
  });
});

describe("OTP endpoints refuse foreign numbers", () => {
  it("auth door: rejects a +1 number with the Pakistani-numbers message", async () => {
    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "+12025550123" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Pakistani numbers/i);
    expect(res.body.devOtp).toBeUndefined();
  });

  it("requester door: rejects a +1 number the same way", async () => {
    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).post("/api/requester/otp/request").send({ phone: "+12025550123" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Pakistani numbers/i);
  });

  it("touches no OTP state: a repeat request is refused identically, not cooled down", async () => {
    const { createApp } = await import("../app");
    const app = createApp();
    // The early reject happens BEFORE getRecord — if any cooldown state had
    // been written, the second call would return a cooldown error instead.
    const first = await request(app).post("/api/auth/otp/request").send({ phone: "+12025550123" });
    const second = await request(app).post("/api/auth/otp/request").send({ phone: "+12025550123" });
    expect(second.status).toBe(first.status);
    expect(second.body.error).toBe(first.body.error);
    expect(second.body.error).toMatch(/Pakistani numbers/i);
  });

  it("a Pakistani number still flows through on the same app", async () => {
    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "+923201234567" });
    expect(res.status).toBe(200);
    expect(res.body.devOtp).toBeTruthy();
  });
});

describe("SMS spend tracker", () => {
  async function withLiveProvider(cap: number) {
    process.env.SMS_PROVIDER = "custom-gateway";
    process.env.SMS_GATEWAY_URL = "https://gateway.example.test/sms";
    process.env.SMS_GLOBAL_DAILY_CAP = String(cap);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 })) as any;
    vi.stubGlobal("fetch", fetchMock);
    const sms = await import("../lib/smsProvider");
    sms.__resetSmsSpendForTest();
    return { sms, fetchMock };
  }

  it("counts sends and refuses once the daily cap is reached", async () => {
    const { sms, fetchMock } = await withLiveProvider(3);
    for (let i = 0; i < 3; i++) {
      expect(await sms.sendSmsGuarded("+923001111111", "hi")).toBe(true);
    }
    expect(sms.getSmsSendStats()).toMatchObject({ sentToday: 3, dailyCap: 3, remaining: 0 });
    expect(sms.smsSpend.alerted100).toBe(true);

    // Over budget: refused, never billed, never delivered.
    expect(await sms.sendSmsGuarded("+923001111111", "hi")).toBe(false);
    expect(await sms.sendSmsGuarded("+923001111111", "hi")).toBe(false);
    expect(sms.smsSpend.sentToday).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("raises the 70% spend alert exactly once", async () => {
    const { sms } = await withLiveProvider(10);
    for (let i = 0; i < 6; i++) {
      await sms.sendSmsGuarded("+923001111111", "hi");
      expect(sms.smsSpend.alerted70).toBe(false);
    }
    await sms.sendSmsGuarded("+923001111111", "hi"); // 7th of 10 → 70%
    expect(sms.smsSpend.alerted70).toBe(true);
    await sms.sendSmsGuarded("+923001111111", "hi");
    expect(sms.smsSpend.alerted70).toBe(true); // stays latched, no repeat
  });

  it("rolls over to a fresh budget on a new UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T23:00:00Z"));
    const { sms } = await withLiveProvider(5);
    await sms.sendSmsGuarded("+923001111111", "hi");
    await sms.sendSmsGuarded("+923001111111", "hi");
    expect(sms.smsSpend.sentToday).toBe(2);

    vi.setSystemTime(new Date("2026-11-28T00:05:00Z"));
    await sms.sendSmsGuarded("+923001111111", "hi");
    expect(sms.smsSpend.sentToday).toBe(1);
    expect(sms.smsSpend.alerted70).toBe(false);
    expect(sms.smsSpend.alerted100).toBe(false);
  });

  it("never caps the console provider (dev/E2E sends are free)", async () => {
    delete process.env.SMS_PROVIDER; // console
    process.env.SMS_GLOBAL_DAILY_CAP = "1";
    const sms = await import("../lib/smsProvider");
    sms.__resetSmsSpendForTest();
    expect(await sms.sendSmsGuarded("+923001111111", "hi")).toBe(true);
    expect(await sms.sendSmsGuarded("+923001111111", "hi")).toBe(true);
    expect(sms.smsSpend.sentToday).toBe(0);
  });
});

describe("Turnstile bot wall", () => {
  it("is a transparent no-op when keys are absent", async () => {
    const { turnstileEnabled, verifyTurnstile } = await import("../lib/turnstile");
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile("", "1.2.3.4")).toBe(true);
    expect(await verifyTurnstile("some-token", "1.2.3.4")).toBe(true);
  });

  it("requires a token when enabled and verifies it with Cloudflare", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAAtest";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAtestsecret";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })) as any;
    vi.stubGlobal("fetch", fetchMock);
    const { verifyTurnstile } = await import("../lib/turnstile");

    expect(await verifyTurnstile("", "1.2.3.4")).toBe(false); // no token, no network
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await verifyTurnstile("solved-token", "1.2.3.4")).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  it("fails closed when Cloudflare is unreachable", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAAtest";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAtestsecret";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }) as any);
    const { verifyTurnstile } = await import("../lib/turnstile");
    expect(await verifyTurnstile("solved-token", "1.2.3.4")).toBe(false);
  });
});

describe("server-side bot wall + public config", () => {
  it("reports the wall off when keys are absent", async () => {
    const { createApp } = await import("../app");
    const res = await request(createApp()).get("/api/config/public");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ turnstile: { enabled: false, siteKey: "" } });
  });

  it("reports the site key (never the secret) when enabled", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAAtest";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAtestsecret";
    const { createApp } = await import("../app");
    const res = await request(createApp()).get("/api/config/public");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ turnstile: { enabled: true, siteKey: "0x4AAAAAAAtest" } });
  });

  it("rejects an OTP request without a token when the wall is on", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAAtest";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAtestsecret";
    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "+923201234568" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bot check/i);
  });

  it("accepts an OTP request with a solved challenge when the wall is on", async () => {
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAAtest";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAAAtestsecret";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })) as any);
    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app)
      .post("/api/auth/otp/request")
      .send({ phone: "+923201234569", turnstileToken: "solved-token" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
