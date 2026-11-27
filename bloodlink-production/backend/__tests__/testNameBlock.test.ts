import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { testNameBlockReason } from "../lib/sosFlags";

// P3b-8: production hard-blocks test-like names at record creation so the
// "Contact reveal test" class of demo rows can never pollute the live
// registry. This file boots the app in production mode (NODE_ENV=production)
// with the in-memory fallback (no MONGO_URI — the fail-fast P0-4 gate
// exempts the vitest runner) and proves donor registration and SOS patient
// names are rejected while real names pass.
//
// The test phones are listed in ADMIN_PHONES so the console SMS provider
// prints their OTP codes (in production the console provider prints ONLY
// admin phones — P3a-1); the test captures the printed code from console.log.
// A successful verify consumes the OTP record, so back-to-back requests on
// the same phone never hit the 60s cooldown.
//
// Runs in its own worker; env is restored in afterAll.

const TEST_PHONE = "+923330001111";
const TEST_PHONE_2 = "+923330001112";

beforeAll(() => {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "prod-test-secret-0123456789abcdef0123456789abcdef";
  process.env.FRONTEND_URL = "https://bloodradar.test";
  process.env.ADMIN_PHONES = `${TEST_PHONE},${TEST_PHONE_2}`;
  delete process.env.ALLOW_DEV_AUTH_SHORTCUTS; // can never be on in prod
  vi.resetModules();
});

afterAll(() => {
  process.env.NODE_ENV = "test";
  delete process.env.JWT_SECRET;
  delete process.env.FRONTEND_URL;
  delete process.env.ADMIN_PHONES;
  vi.resetModules();
});

async function requestOtpAndCaptureCode(app: any, phone: string): Promise<string> {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const res = await request(app).post("/api/auth/otp/request").send({ phone });
    expect(res.status).toBe(200);
    const printed = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const match = printed.match(/verification code is (\d{6})/);
    expect(match, `expected the console provider to print a code for admin phone ${phone}`).not.toBeNull();
    return match![1];
  } finally {
    logSpy.mockRestore();
  }
}

describe("test-like name blocking in production (P3b-8)", () => {
  it("donor registration rejects test-like names but accepts real names", async () => {
    const { createApp } = await import("../app");
    const app = createApp();

    // Blocked: keyword name. The OTP itself verifies fine; the NAME is
    // rejected afterwards, before any donor row is written.
    let code = await requestOtpAndCaptureCode(app, TEST_PHONE);
    let res = await request(app).post("/api/auth/otp/verify").send({
      phone: TEST_PHONE,
      code,
      registerAsDonor: true,
      privacyConsent: true,
      name: "Test User",
      bloodGroup: "A+",
      city: "Islamabad",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/test entry/i);

    // The rejected code was consumed, so a fresh request works immediately.
    code = await requestOtpAndCaptureCode(app, TEST_PHONE);
    res = await request(app).post("/api/auth/otp/verify").send({
      phone: TEST_PHONE,
      code,
      registerAsDonor: true,
      privacyConsent: true,
      name: "Ayesha Khan",
      bloodGroup: "A+",
      city: "Islamabad",
    });
    expect(res.status).toBe(200);

    const { getDonorByPhone } = await import("../services/dbService");
    const donor = await getDonorByPhone(TEST_PHONE);
    expect(donor?.name).toBe("Ayesha Khan");
  });

  it("SOS creation rejects test-like patient names in production", async () => {
    const { createApp } = await import("../app");
    const app = createApp();
    const agent = request.agent(app);

    // Sign in as the donor registered above (signed-in posters skip the
    // requester proof token, so the name block is the only gate in play).
    // Prod-mode auth cookies are Secure, which supertest's jar drops over
    // plain http — pass the raw name=value pairs explicitly instead.
    const code = await requestOtpAndCaptureCode(app, TEST_PHONE);
    const login = await agent.post("/api/auth/otp/verify").send({ phone: TEST_PHONE, code });
    expect(login.status).toBe(200);
    const authCookies = (login.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");

    const blocked = await request(app)
      .post("/api/emergencies")
      .set("Cookie", authCookies)
      .send({
        patientName: "demo patient",
        bloodGroup: "B+",
        unitsNeeded: 1,
        contactPhone: TEST_PHONE_2,
        reason: "Testing the board",
        urgency: "Immediate (SOS)",
        city: "Islamabad",
      });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/test entry/i);

    const allowed = await request(app)
      .post("/api/emergencies")
      .set("Cookie", authCookies)
      .send({
        patientName: "Bilal Ahmed",
        bloodGroup: "B+",
        unitsNeeded: 1,
        contactPhone: TEST_PHONE_2,
        reason: "Surgical emergency",
        urgency: "Immediate (SOS)",
        city: "Islamabad",
      });
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);
  });
});

describe("testNameBlockReason classifier (P3b-8)", () => {
  it("blocks unambiguous test-like names", () => {
    expect(testNameBlockReason("Test User")).not.toBeNull();
    expect(testNameBlockReason("demo")).not.toBeNull();
    expect(testNameBlockReason("Tester Ahmed")).not.toBeNull();
    expect(testNameBlockReason("asdf")).not.toBeNull();
    expect(testNameBlockReason("12345")).not.toBeNull();
  });

  it("keeps real names safe (word boundaries)", () => {
    expect(testNameBlockReason("Amber Testoni")).toBeNull();
    expect(testNameBlockReason("Ayesha Khan")).toBeNull();
    expect(testNameBlockReason("Muhammad Zubair")).toBeNull();
    expect(testNameBlockReason("Samplewala Traders")).toBeNull();
    expect(testNameBlockReason("")).toBeNull();
  });
});
