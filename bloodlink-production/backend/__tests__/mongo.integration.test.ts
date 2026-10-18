// MongoDB Atlas integration test — runs ONLY when TEST_MONGO_URI is set:
//   TEST_MONGO_URI="mongodb+srv://..." npx vitest run backend/__tests__/mongo.integration.test.ts
//
// Without the env var the whole suite skips. This is the deploy-day
// verification for the real database path: connection, seeding, CRUD
// round-trips, unique-phone index, and SOS status updates — the exact
// things that stay untested while the fallback in-memory store is used.
//
// Every record this file creates uses a random test phone and is deleted
// in afterAll, so it is safe to point TEST_MONGO_URI at the production
// cluster (it uses the same "bloodradar" database).

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const testUri = process.env.TEST_MONGO_URI || "";

// Config reads process.env.MONGO_URI at module load, so it must be set
// BEFORE dbService (and therefore config) is imported. Dynamic import +
// per-file module isolation makes that safe; other test files still get
// the clean fallback store.
let dbService: typeof import("../services/dbService");

const testPhone = "+92319" + String(Math.floor(1000000 + Math.random() * 8999999));
let testSosId = "";

describe.skipIf(!testUri)(
  "MongoDB Atlas integration (requires TEST_MONGO_URI)",
  { timeout: 90_000 },
  () => {
    beforeAll(async () => {
      process.env.MONGO_URI = testUri;
      dbService = await import("../services/dbService");
    });

    it("connects in mongodb mode and seeds collections", async () => {
      const { mode, db } = await dbService.getDb();
      expect(mode).toBe("mongodb");
      expect(db).not.toBeNull();
      const users = await db!.collection("users").countDocuments();
      const donors = await db!.collection("donors").countDocuments();
      expect(users).toBeGreaterThan(0);
      expect(donors).toBeGreaterThan(0);
    });

    it("persists a donor round-trip and rejects duplicates (unique index)", async () => {
      const donor = {
        id: "test-donor-" + Date.now(),
        phone: testPhone,
        name: "Mongo Integration Donor",
        bloodGroup: "A+",
        city: "Islamabad",
        isAvailable: true,
        isSample: true,
      };
      await dbService.addDonor(donor);
      const fetched = await dbService.getDonorByPhone(testPhone);
      expect(fetched).not.toBeNull();
      expect(fetched.name).toBe("Mongo Integration Donor");
      expect(fetched.bloodGroup).toBe("A+");

      await expect(dbService.addDonor(donor)).rejects.toThrow(/already registered/);
    });

    it("persists an SOS round-trip and status update", async () => {
      const sos = {
        id: "test-sos-" + Date.now(),
        patientName: "Mongo Integration Patient",
        bloodGroup: "A+",
        unitsNeeded: 1,
        hospitalId: "test",
        hospitalName: "Test Hospital",
        contactPhone: testPhone,
        requiredBy: "2026-12-31",
        reason: "Integration test",
        urgency: "Immediate (SOS)",
        status: "Pending",
        city: "Islamabad",
        createdAt: new Date().toISOString(),
        matchingDonorsCount: 0,
        requesterCode: "testcode",
        isSample: true,
      };
      await dbService.addEmergency(sos);
      testSosId = sos.id;
      const fetched = await dbService.getEmergencyById(sos.id);
      expect(fetched).not.toBeNull();
      expect(fetched.status).toBe("Pending");

      await dbService.updateEmergencyStatus(sos.id, "Fulfilled");
      const updated = await dbService.getEmergencyById(sos.id);
      expect(updated.status).toBe("Fulfilled");
      expect(updated.fulfilledAt).toBeTruthy();
    });

    afterAll(async () => {
      // Clean up everything this file created, so pointing the test at the
      // production cluster leaves zero trace.
      const { db } = await dbService.getDb();
      if (db) {
        await db.collection("donors").deleteMany({ phone: testPhone });
        await db.collection("emergencies").deleteMany({ contactPhone: testPhone });
        if (testSosId) await db.collection("emergencies").deleteMany({ id: testSosId });
      }
      console.log(`[mongo.integration] cleaned up test records for ${testPhone}`);
    });
  }
);
