import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { uniquePhone } from "./helpers";

// The master prompt's done-when: "rate limits demonstrably trigger."
// Each test builds a fresh app so its limiters start at zero.

describe("rate limits", () => {
  it("blocks a 6th SOS in 10 minutes with 429", async () => {
    const app = createApp();
    const body = {
      patientName: "Rate Test",
      bloodGroup: "O-",
      unitsNeeded: 1,
      contactPhone: uniquePhone(),
      reason: "Rate limit test",
      urgency: "Immediate (SOS)",
      city: "Islamabad",
    };
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/emergencies").send(body);
      expect(res.status).toBe(200);
    }
    const sixth = await request(app).post("/api/emergencies").send(body);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBeTruthy();
  });

  it("blocks a 6th OTP request in 10 minutes (per IP) with 429", async () => {
    const app = createApp();
    // Different phones each time: the per-phone 60s cooldown must not be
    // what triggers this — the per-IP limiter is what we are proving.
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/auth/otp/request")
        .send({ phone: uniquePhone() });
      expect(res.status).toBe(200);
    }
    const sixth = await request(app)
      .post("/api/auth/otp/request")
      .send({ phone: uniquePhone() });
    expect(sixth.status).toBe(429);
  });

  it("blocks an 11th OTP verify in 10 minutes (per IP) with 429", async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      // Unknown phones/codes fail validation at the route level (400) but
      // still count against the limiter, which runs first.
      await request(app)
        .post("/api/auth/otp/verify")
        .send({ phone: uniquePhone(), code: "123456" });
    }
    const eleventh = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: uniquePhone(), code: "123456" });
    expect(eleventh.status).toBe(429);
  });
});
