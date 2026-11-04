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

// Requester phone proof (P0-1): request the requester-door OTP, verify it,
// and return the 15-minute proof token an anonymous SOS must present.
export async function requestProof(app: Express, phone: string): Promise<string> {
  const req = await request(app).post("/api/requester/otp/request").send({ phone });
  if (req.status !== 200) {
    throw new Error(`Requester OTP request failed (${req.status}): ${JSON.stringify(req.body)}`);
  }
  const code = req.body.devOtp as string;
  const ver = await request(app).post("/api/requester/otp/verify").send({ phone, code });
  if (ver.status !== 200) {
    throw new Error(`Requester OTP verify failed (${ver.status}): ${JSON.stringify(ver.body)}`);
  }
  return ver.body.proofToken as string;
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
// one-time requesterCode plus the public request payload. P0-1: the
// contact phone is OTP-verified first and the proof token travels with
// the request, exactly like the real UI flow.
export async function createSos(
  app: Express,
  opts: { bloodGroup?: string; city?: string; contactPhone?: string } = {}
) {
  const contactPhone = opts.contactPhone || uniquePhone();
  const proofToken = await requestProof(app, contactPhone);
  const res = await request(app)
    .post("/api/emergencies")
    .send({
      patientName: "Test Patient",
      bloodGroup: opts.bloodGroup || "O-",
      unitsNeeded: 1,
      contactPhone,
      reason: "Test emergency",
      urgency: "Immediate (SOS)",
      city: opts.city || "Islamabad",
      proofToken,
    });
  if (res.status !== 200) {
    throw new Error(`SOS creation failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { request: res.body.request, requesterCode: res.body.requesterCode as string };
}
