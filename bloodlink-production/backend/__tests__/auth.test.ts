import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { uniquePhone, requestOtp, registerDonor, loginAs } from "./helpers";

// Phase 1 auth contract:
//  - OTP → short-lived JWT access + 7-day refresh in httpOnly cookies
//  - no route trusts client-supplied identity (401 without a session)
//  - OTP codes are hashed at rest and never returned in production
//  - 5 wrong attempts exhaust the code; resends are cooled down
//  - roles come from OTP-verified phone lists, never from the request body

describe("OTP login flow", () => {
  it("registers a donor, sets httpOnly session cookies, and serves /me", async () => {
    const app = createApp();
    const phone = uniquePhone();

    const reqRes = await request(app).post("/api/auth/otp/request").send({ phone });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body.success).toBe(true);
    expect(typeof reqRes.body.devOtp).toBe("string");

    const agent = request.agent(app);
    const verifyRes = await agent.post("/api/auth/otp/verify").send({
      phone,
      code: reqRes.body.devOtp,
      registerAsDonor: true,
      name: "Auth Test Donor",
      bloodGroup: "B+",
      city: "Rawalpindi",
      location: "Saddar",
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user.role).toBe("donor");
    expect(verifyRes.body.user.phone).toBe(phone);
    expect(verifyRes.body.user.donor.bloodGroup).toBe("B+");

    // Cookies must be httpOnly so page scripts can never steal the session.
    const setCookies = (verifyRes.headers["set-cookie"] || []) as string[];
    expect(setCookies.some((c) => c.startsWith("br_access="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("br_refresh="))).toBe(true);
    expect(setCookies.every((c) => c.toLowerCase().includes("httponly"))).toBe(true);

    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.phone).toBe(phone);
    expect(meRes.body.user.donor.name).toBe("Auth Test Donor");
  });

  it("401s /me without a session", async () => {
    const app = createApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong code and exhausts the OTP after 5 attempts", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const code = await requestOtp(app, phone);

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/auth/otp/verify")
        .send({ phone, code: "000000" });
      expect(res.status).toBe(400);
    }
    const fifth = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone, code: "000000" });
    expect(fifth.status).toBe(400);

    // Even the real code no longer works — the record was exhausted.
    const exhausted = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone, code });
    expect(exhausted.status).toBe(400);
  });

  it("cools down resends for the same phone (60s)", async () => {
    const app = createApp();
    const phone = uniquePhone();
    await requestOtp(app, phone);
    const res = await request(app).post("/api/auth/otp/request").send({ phone });
    expect(res.status).toBe(429);
  });

  it("requires name + blood group when registering as donor", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const code = await requestOtp(app, phone);
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone, code, registerAsDonor: true });
    expect(res.status).toBe(400);
  });

  it("refreshes the access token from the refresh cookie, then logout clears", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);

    const refreshRes = await agent.post("/api/auth/refresh");
    expect(refreshRes.status).toBe(200);
    const cookies = (refreshRes.headers["set-cookie"] || []) as string[];
    expect(cookies.some((c) => c.startsWith("br_access="))).toBe(true);

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(200);

    // After logout the same agent must be anonymous again.
    const meRes = await agent.get("/api/auth/me");
    expect(meRes.status).toBe(401);
  });
});

describe("roles", () => {
  it("grants admin to the configured admin phone and none to ordinary donors", async () => {
    const app = createApp();
    // Dev-only seeded demo admin (config.ts). Production starts with an
    // empty list and requires explicit ADMIN_PHONES env configuration.
    const { user: adminUser } = await loginAs(app, "+923331234567");
    expect(adminUser.role).toBe("admin");

    const { user: donorUser } = await registerDonor(app);
    expect(donorUser.role).toBe("donor");
  });
});
