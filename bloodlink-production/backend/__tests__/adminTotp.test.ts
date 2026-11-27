import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOtpauthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpAt,
  verifyTotp,
} from "../lib/totp";

// P3a-8: admin two-step verification (TOTP) + new-device alert.
//
// Flow under test:
//   - enrollment returns the secret + QR exactly once; confirming with a
//     valid app code activates TOTP and hands out 8 one-time recovery codes
//   - once active, the phone OTP alone returns 403 TOTP_REQUIRED with NO
//     session cookie — only /totp/verify (app code or recovery code) mints
//     one, and it must run within 5 minutes of the phone step
//   - a recovery code works exactly once
//   - every distinct device cookie is recorded; the first sign-in from one
//     audit-logs admin_new_device (the SMS alert goes through the console
//     provider in tests)
//   - disabling requires a live app code
//   - ADMIN_TOTP_RESET=true wipes all admin two-step state on boot
//
// CONFIG is module-level, so each test sets ADMIN_PHONES and imports fresh
// modules (vi.resetModules) — fresh rate-limiters and a fresh OTP store
// every time, and the OTP record is deleted on successful verify, so the
// 60s re-request cooldown never trips inside a test.

const PHONE_A = "+923321111111";
const PHONE_B = "+923321111112";
const PHONE_C = "+923321111113";
const PHONE_D = "+923321111114";

afterEach(() => {
  delete process.env.ADMIN_PHONES;
  delete process.env.ADMIN_TOTP_RESET;
  vi.resetModules();
});

describe("totp lib", () => {
  it("verifyTotp accepts the current code and the ±1 window, rejects the rest", () => {
    const secret = generateTotpSecret();
    const nowMs = 1_700_000_000_000;
    const nowSec = Math.floor(nowMs / 1000);
    expect(verifyTotp(secret, totpAt(secret, nowSec), { nowMs })).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, nowSec - 30), { nowMs })).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, nowSec + 30), { nowMs })).toBe(true);
    // Two windows away → rejected.
    expect(verifyTotp(secret, totpAt(secret, nowSec + 60), { nowMs })).toBe(false);
    // A different secret's code → rejected.
    expect(verifyTotp(secret, totpAt(generateTotpSecret(), nowSec), { nowMs })).toBe(false);
  });

  it("generates 8 unique well-formed recovery codes with stable hashes", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    for (const c of codes) {
      expect(c).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    }
    expect(new Set(codes).size).toBe(8);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, "")));
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });

  it("builds a scannable otpauth URI for the phone + secret", () => {
    const url = buildOtpauthUrl("+923331234567", "ABCDEFGHIJKLMNOP");
    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("secret=ABCDEFGHIJKLMNOP");
    expect(url).toContain("issuer=BloodRadar");
    expect(url).toContain("digits=6");
  });
});

describe("enrollment through the admin panel", () => {
  it("returns the secret once, activates on a valid code, and hands out recovery codes", async () => {
    process.env.ADMIN_PHONES = PHONE_A;
    const { createApp } = await import("../app");
    const { loginAs, requestOtp } = await import("./helpers");
    const app = createApp();
    const { agent, phone } = await loginAs(app, PHONE_A);

    // Honest starting state.
    const sec0 = await agent.get("/api/admin/security");
    expect(sec0.status).toBe(200);
    expect(sec0.body).toMatchObject({ totpEnabled: false, pendingEnrollment: false, recoveryCodesRemaining: 0 });
    expect(sec0.body.devices).toHaveLength(1); // this browser is now known

    const enroll = await agent.post("/api/admin/security/totp/enroll");
    expect(enroll.status).toBe(200);
    expect(enroll.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enroll.body.otpauthUrl).toContain("otpauth://totp/");
    expect(enroll.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // A wrong code doesn't activate anything.
    const bad = await agent.post("/api/admin/security/totp/enroll/confirm").send({ code: "000000" });
    expect(bad.status).toBe(400);

    const code = totpAt(enroll.body.secret, Math.floor(Date.now() / 1000));
    const confirm = await agent.post("/api/admin/security/totp/enroll/confirm").send({ code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(8);
    for (const rc of confirm.body.recoveryCodes) expect(rc).toMatch(/^\d{4}-\d{4}-\d{4}$/);

    const sec1 = await agent.get("/api/admin/security");
    expect(sec1.body).toMatchObject({ totpEnabled: true, pendingEnrollment: false, recoveryCodesRemaining: 8 });

    // A second browser tries to sign in with the phone code alone.
    const agent2 = request.agent(app);
    const code2 = await requestOtp(app, phone);
    const verify2 = await agent2.post("/api/auth/otp/verify").send({ phone, code: code2 });
    expect(verify2.status).toBe(403);
    expect(verify2.body.code).toBe("TOTP_REQUIRED");
    const cookies2 = (verify2.headers["set-cookie"] || []) as string[];
    expect(cookies2.some((c) => c.startsWith("br_access="))).toBe(false);
    expect(cookies2.some((c) => c.startsWith("br_refresh="))).toBe(false);

    const meBlocked = await agent2.get("/api/auth/me");
    expect(meBlocked.status).toBe(401);

    // Wrong app code → 400, and the pending step survives for a retry.
    const wrong = await agent2.post("/api/auth/totp/verify").send({ phone, code: "999999" });
    expect(wrong.status).toBe(400);

    const codeNow = totpAt(enroll.body.secret, Math.floor(Date.now() / 1000));
    const finish = await agent2.post("/api/auth/totp/verify").send({ phone, code: codeNow });
    expect(finish.status).toBe(200);
    expect(finish.body.user.role).toBe("admin");

    const meOk = await agent2.get("/api/auth/me");
    expect(meOk.status).toBe(200);
    expect(meOk.body.user.role).toBe("admin");
    expect(await (await agent2.get("/api/admin/security")).status).toBe(200);
  });

  it("requires the phone step first — a cold totp/verify call is refused", async () => {
    process.env.ADMIN_PHONES = PHONE_B;
    const { createApp } = await import("../app");
    const { setAdminSecurity } = await import("../services/dbService");
    await setAdminSecurity({ phone: PHONE_B, totpEnabled: true, totpSecret: generateTotpSecret(), recoveryCodeHashes: [], knownDevices: [] });
    const app = createApp();
    const res = await request(app).post("/api/auth/totp/verify").send({ phone: PHONE_B, code: "123456" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe("recovery codes, new devices and forgetting devices", () => {
  it("tracks devices, alerts via audit, consumes recovery codes once, and forgets devices", async () => {
    process.env.ADMIN_PHONES = PHONE_B;
    const { createApp } = await import("../app");
    const { getAuditLogs, setAdminSecurity } = await import("../services/dbService");
    const { requestOtp } = await import("./helpers");

    const secret = generateTotpSecret();
    const rc1 = generateRecoveryCodes(1)[0];
    const rc2 = generateRecoveryCodes(1)[0];
    await setAdminSecurity({
      phone: PHONE_B,
      totpEnabled: true,
      totpSecret: secret,
      recoveryCodeHashes: [hashRecoveryCode(rc1), hashRecoveryCode(rc2)],
      knownDevices: [],
    });
    const app = createApp();

    async function loginWith(agent: any, totpOrRecovery: string) {
      const otp = await requestOtp(app, PHONE_B);
      const v = await agent.post("/api/auth/otp/verify").send({ phone: PHONE_B, code: otp });
      expect(v.status).toBe(403);
      expect(v.body.code).toBe("TOTP_REQUIRED");
      const t = await agent.post("/api/auth/totp/verify").send({ phone: PHONE_B, code: totpOrRecovery });
      return t;
    }

    // Device A signs in with recovery code 1.
    const agentA = request.agent(app);
    const loginA = await loginWith(agentA, rc1);
    expect(loginA.status).toBe(200);
    const secA = await agentA.get("/api/admin/security");
    expect(secA.body.devices).toHaveLength(1);
    expect(secA.body.recoveryCodesRemaining).toBe(1);
    const deviceA = secA.body.devices[0].id as string;

    // Device B signs in with recovery code 2 → new-device audit entry exists.
    const agentB = request.agent(app);
    const loginB = await loginWith(agentB, rc2);
    expect(loginB.status).toBe(200);
    const secB = await agentB.get("/api/admin/security");
    expect(secB.body.devices).toHaveLength(2);
    expect(secB.body.recoveryCodesRemaining).toBe(0);

    const auditB = await agentB.get("/api/admin/audit");
    const actions = (auditB.body as any[]).map((e) => e.action);
    expect(actions).toContain("admin_new_device");
    expect(actions.filter((a) => a === "admin_recovery_code_used").length).toBe(2);

    // A consumed recovery code no longer works.
    const agentC = request.agent(app);
    const loginC = await loginWith(agentC, rc1);
    expect(loginC.status).toBe(400);

    // Forgetting device A removes exactly that one.
    const del = await agentB.delete(`/api/admin/security/devices/${encodeURIComponent(deviceA)}`);
    expect(del.status).toBe(200);
    const secAfter = await agentB.get("/api/admin/security");
    expect(secAfter.body.devices).toHaveLength(1);
    expect(secAfter.body.devices[0].id).not.toBe(deviceA);
    const del404 = await agentB.delete(`/api/admin/security/devices/${encodeURIComponent(deviceA)}`);
    expect(del404.status).toBe(404);
  });
});

describe("disabling two-step", () => {
  it("needs a live app code, then phone OTP alone works again", async () => {
    process.env.ADMIN_PHONES = PHONE_C;
    const { createApp } = await import("../app");
    const { setAdminSecurity } = await import("../services/dbService");
    const { requestOtp } = await import("./helpers");

    const secret = generateTotpSecret();
    await setAdminSecurity({ phone: PHONE_C, totpEnabled: true, totpSecret: secret, recoveryCodeHashes: [], knownDevices: [] });
    const app = createApp();

    const agent = request.agent(app);
    const otp = await requestOtp(app, PHONE_C);
    const v = await agent.post("/api/auth/otp/verify").send({ phone: PHONE_C, code: otp });
    expect(v.status).toBe(403);
    const t = await agent.post("/api/auth/totp/verify").send({ phone: PHONE_C, code: totpAt(secret, Math.floor(Date.now() / 1000)) });
    expect(t.status).toBe(200);

    // Wrong code can't disable.
    const bad = await agent.post("/api/admin/security/totp/disable").send({ code: "999999" });
    expect(bad.status).toBe(400);
    const stillOn = await agent.get("/api/admin/security");
    expect(stillOn.body.totpEnabled).toBe(true);

    // A live code can.
    const off = await agent.post("/api/admin/security/totp/disable").send({ code: totpAt(secret, Math.floor(Date.now() / 1000)) });
    expect(off.status).toBe(200);
    const secOff = await agent.get("/api/admin/security");
    expect(secOff.body.totpEnabled).toBe(false);

    // Now the phone code alone signs straight in.
    const agent2 = request.agent(app);
    const otp2 = await requestOtp(app, PHONE_C);
    const v2 = await agent2.post("/api/auth/otp/verify").send({ phone: PHONE_C, code: otp2 });
    expect(v2.status).toBe(200);
    expect(v2.body.user.role).toBe("admin");
  });
});

describe("ADMIN_TOTP_RESET recovery flag", () => {
  it("audit-logs the boot reset and leaves normal operation intact", async () => {
    process.env.ADMIN_PHONES = PHONE_D;
    process.env.ADMIN_TOTP_RESET = "true";
    const { createApp } = await import("../app");
    const { getAdminSecurity, getAuditLogs, getDb, setAdminSecurity } = await import("../services/dbService");
    const { requestOtp } = await import("./helpers");

    // With the reset flag set, any first DB touch wipes all admin two-step
    // state (in memory mode the store was already empty; in MongoDB the
    // whole adminsecurity collection goes) and audit-logs the event.
    const app = createApp();
    const agent = request.agent(app);
    const otp = await requestOtp(app, PHONE_D);
    const v = await agent.post("/api/auth/otp/verify").send({ phone: PHONE_D, code: otp });
    expect(v.status).toBe(200);
    expect(v.body.user.role).toBe("admin");

    const logs = await getAuditLogs();
    expect(logs.some((l) => l.action === "admin_totp_reset")).toBe(true);

    // The flag is one-shot: a record written after the boot reset persists,
    // so normal operation isn't affected.
    await setAdminSecurity({ phone: PHONE_D, totpEnabled: true, totpSecret: "X", recoveryCodeHashes: ["abc"], knownDevices: [] });
    expect(await getAdminSecurity(PHONE_D)).not.toBeNull();
    await getDb(); // extra DB touch must not wipe it again
    expect(await getAdminSecurity(PHONE_D)).not.toBeNull();
  });
});
