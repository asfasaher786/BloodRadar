import request from "supertest";
import type { Express } from "express";

// Shared helpers for API tests. Tests run against the in-memory fallback DB
// (no MONGO_URI in CI), so phones must be unique per test to avoid colliding
// with seeded donors or earlier tests.

let counter = 0;
export function uniquePhone(): string {
  counter += 1;
  return "+9232" + String(2000000 + counter);
}

// Requests an OTP in dev/test mode and returns the code (console provider
// echoes it in the response — this field must never exist in production).
export async function requestOtp(app: Express, phone: string): Promise<string> {
  const res = await request(app).post("/api/auth/otp/request").send({ phone });
  if (res.status !== 200) {
    throw new Error(`OTP request failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.devOtp as string;
}

// Full register flow: request OTP → verify with registerAsDonor. Returns a
// supertest agent whose cookie jar carries the resulting httpOnly session.
export async function registerDonor(
  app: Express,
  opts: { phone?: string; bloodGroup?: string; city?: string; name?: string } = {}
) {
  const phone = opts.phone || uniquePhone();
  const agent = request.agent(app);
  const code = await requestOtp(app, phone);
  const res = await agent.post("/api/auth/otp/verify").send({
    phone,
    code,
    registerAsDonor: true,
    name: opts.name || "Test Donor",
    bloodGroup: opts.bloodGroup || "O-",
    city: opts.city || "Islamabad",
    location: "G-10/4",
  });
  if (res.status !== 200) {
    throw new Error(`Verify failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { agent, phone, user: res.body.user };
}

// Logs in an existing phone (OTP → verify) without registering a donor.
export async function loginAs(app: Express, phone: string) {
  const agent = request.agent(app);
  const code = await requestOtp(app, phone);
  const res = await agent.post("/api/auth/otp/verify").send({ phone, code });
  if (res.status !== 200) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { agent, phone, user: res.body.user };
}

// Creates an anonymous SOS (requesters never log in) and returns the
// one-time requesterCode plus the public request payload.
export async function createSos(
  app: Express,
  opts: { bloodGroup?: string; city?: string; contactPhone?: string } = {}
) {
  const res = await request(app)
    .post("/api/emergencies")
    .send({
      patientName: "Test Patient",
      bloodGroup: opts.bloodGroup || "O-",
      unitsNeeded: 1,
      contactPhone: opts.contactPhone || uniquePhone(),
      reason: "Test emergency",
      urgency: "Immediate (SOS)",
      city: opts.city || "Islamabad",
    });
  if (res.status !== 200) {
    throw new Error(`SOS creation failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { request: res.body.request, requesterCode: res.body.requesterCode as string };
}
