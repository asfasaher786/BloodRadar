import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

// P0-2: dev auth shortcuts (devOtp hints, demo admin auto-grant) are
// opt-in via ALLOW_DEV_AUTH_SHORTCUTS. The suite default (vitest env +
// local .env) has the flag ON; these tests prove the gate actually closes
// when it is OFF, by re-importing the config/app with the flag cleared.
//
// Order matters: flag-on assertions run first, then the env is flipped and
// modules are reset. This file runs in its own worker, so the reset cannot
// pollute other test files.

describe("dev auth shortcuts flag (P0-2)", () => {
  it("flag on (test default): devOtp is returned and demo admin is granted", async () => {
    const { CONFIG } = await import("../config/config");
    const { createApp } = await import("../app");
    expect(CONFIG.ALLOW_DEV_AUTH_SHORTCUTS).toBe(true);
    expect(CONFIG.ADMIN_PHONES).toContain("+923331234567");

    const app = createApp();
    const res = await request(app).post("/api/auth/otp/request").send({ phone: "+923200000001" });
    expect(res.status).toBe(200);
    expect(typeof res.body.devOtp).toBe("string");
  });

  it("flag off: devOtp disappears from BOTH OTP doors", async () => {
    process.env.ALLOW_DEV_AUTH_SHORTCUTS = "false";
    vi.resetModules();

    const { createApp } = await import("../app");
    const app = createApp();

    const authRes = await request(app).post("/api/auth/otp/request").send({ phone: "+923200000002" });
    expect(authRes.status).toBe(200);
    expect(authRes.body.success).toBe(true);
    expect(authRes.body.devOtp).toBeUndefined();

    // Requester phone-proof door (P0-1) shares the same otpService gate.
    const requesterRes = await request(app).post("/api/requester/otp/request").send({ phone: "+923200000003" });
    expect(requesterRes.status).toBe(200);
    expect(requesterRes.body.success).toBe(true);
    expect(requesterRes.body.devOtp).toBeUndefined();
  });

  it("flag off: demo admin phone is NOT auto-granted; explicit ADMIN_PHONES still work", async () => {
    process.env.ALLOW_DEV_AUTH_SHORTCUTS = "false";
    process.env.ADMIN_PHONES = "+923001111111"; // operator-configured, not a shortcut
    vi.resetModules();

    const { CONFIG } = await import("../config/config");
    expect(CONFIG.ALLOW_DEV_AUTH_SHORTCUTS).toBe(false);
    expect(CONFIG.ADMIN_PHONES).not.toContain("+923331234567"); // demo admin gone
    expect(CONFIG.ADMIN_PHONES).toContain("+923001111111"); // explicit config honoured
  });

  afterAll(() => {
    // Restore the suite default so any later import in this worker is clean.
    process.env.ALLOW_DEV_AUTH_SHORTCUTS = "true";
    delete process.env.ADMIN_PHONES;
    vi.resetModules();
  });
});
