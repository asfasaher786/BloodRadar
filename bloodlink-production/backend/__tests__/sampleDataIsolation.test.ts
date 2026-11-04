import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// P0-3: sample/demo rows (seeded with isSample: true) must never reach
// public endpoints, matching, or counts in PRODUCTION. This file boots the
// app in production mode (NODE_ENV=production) with the in-memory fallback
// (no MONGO_URI — the fail-fast P0-4 gate exempts the vitest runner), and
// proves the public surface serves only real data while the admin opt-in
// still sees the sample rows.
//
// Runs in its own worker; env is restored in afterAll.

beforeAll(() => {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "prod-test-secret-0123456789abcdef0123456789abcdef";
  process.env.FRONTEND_URL = "https://bloodradar.test";
  delete process.env.ALLOW_DEV_AUTH_SHORTCUTS; // can never be on in prod
  vi.resetModules();
});

afterAll(() => {
  process.env.NODE_ENV = "test";
  delete process.env.JWT_SECRET;
  delete process.env.FRONTEND_URL;
  vi.resetModules();
});

describe("sample data isolation in production (P0-3)", () => {
  it("public endpoints serve no sample rows in production", async () => {
    const { createApp } = await import("../app");
    const app = createApp();

    const [donors, hospitals, camps, emergencies, notifications] = await Promise.all([
      request(app).get("/api/donors"),
      request(app).get("/api/hospitals"),
      request(app).get("/api/camps"),
      request(app).get("/api/emergencies"),
      request(app).get("/api/notifications"),
    ]);

    for (const res of [donors, hospitals, camps, emergencies, notifications]) {
      expect(res.status).toBe(200);
    }
    expect(donors.body).toEqual([]);
    expect(hospitals.body).toEqual([]);
    expect(camps.body).toEqual([]);
    expect(emergencies.body).toEqual([]);
    expect(notifications.body).toEqual([]);
  });

  it("public stats and SOS lookups exclude sample data in production", async () => {
    const { createApp } = await import("../app");
    const app = createApp();

    const stats = await request(app).get("/api/stats");
    expect(stats.status).toBe(200);
    expect(stats.body.totals.totalDonors).toBe(0);
    expect(stats.body.totals.activeSOS).toBe(0);

    // A seeded sample SOS must be unreachable through the public API.
    const matches = await request(app).get("/api/emergencies/sos-1/matches");
    expect(matches.status).toBe(404);
  });

  it("a REAL row stays visible in production while samples stay hidden", async () => {
    const { createApp } = await import("../app");
    const { getEmergencies, addEmergency } = await import("../services/dbService");

    const app = createApp();
    await addEmergency({
      id: "sos-real-1",
      patientName: "Real Patient",
      bloodGroup: "O+",
      unitsNeeded: 1,
      contactPhone: "+923001111222",
      reason: "Real need",
      urgency: "Immediate (SOS)",
      city: "Islamabad",
      hospitalId: null,
      hospitalName: null,
      status: "Pending",
      createdAt: new Date().toISOString(),
    });

    const board = await request(app).get("/api/emergencies");
    expect(board.status).toBe(200);
    const ids = board.body.map((e: any) => e.id);
    expect(ids).toContain("sos-real-1");
    expect(ids).not.toContain("sos-1"); // seeded sample stays hidden

    // The write-side duplicate/cap checks also read filtered rows in prod.
    const all = await getEmergencies();
    expect(all.map((e: any) => e.id)).toEqual(["sos-real-1"]);
  });

  it("the admin opt-in (includeSample) still sees seeded rows", async () => {
    const { getDonors, getEmergencyById } = await import("../services/dbService");

    const donors = await getDonors({ includeSample: true });
    expect(donors.length).toBeGreaterThan(0);
    expect(donors.some((d: any) => d.isSample === true)).toBe(true);

    const sampleSos = await getEmergencyById("sos-1", { includeSample: true });
    expect(sampleSos).not.toBeNull();
    const hiddenByDefault = await getEmergencyById("sos-1");
    expect(hiddenByDefault).toBeNull();
  });

  it("seeded donors are not OTP-verified (Verified badge = completed OTP)", async () => {
    const { getDonors } = await import("../services/dbService");
    const donors = await getDonors({ includeSample: true });
    for (const d of donors) {
      if (d.isSample === true) {
        expect(d.isVerified).toBe(false);
      }
    }
  });
});
