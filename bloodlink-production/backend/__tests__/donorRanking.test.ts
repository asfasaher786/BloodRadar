import { describe, it, expect } from "vitest";
import { scoreDonorForSos, rankDonorsForSos } from "../services/donorRanking";

// Transparent ranking contract: every point comes with a human-readable
// reason; the score stays in 0–100; incompatible donors are excluded; and
// no machine learning is involved anywhere.

const baseDonor = {
  id: "d1",
  name: "Test Donor",
  bloodGroup: "O+",
  phone: "+923001234567",
  city: "Islamabad",
  latitude: 33.69,
  longitude: 73.01,
  isAvailable: true,
  nextEligibleDate: undefined as string | undefined,
};

const baseSos = { bloodGroup: "O+", city: "Islamabad", hospitalId: "hosp-1" };
const baseHospital = { id: "hosp-1", name: "PIMS", latitude: 33.70, longitude: 73.02, city: "Islamabad" };
const noHistory = { accepted: 0, declined: 0, expired: 0, superseded: 0 };

describe("transparent donor ranking", () => {
  it("scores an exact-match, available, eligible donor and explains every point", () => {
    const r = scoreDonorForSos(baseDonor, baseSos, baseHospital, noHistory);
    expect(r.score).toBeGreaterThan(60);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.reasons.some(s => s.includes("Exact O+ match"))).toBe(true);
    expect(r.reasons.some(s => s.includes("km from the hospital"))).toBe(true);
    expect(r.reasons.some(s => s.includes("Available now"))).toBe(true);
    expect(r.reasons.some(s => s.includes("Eligible to donate now"))).toBe(true);
    expect(r.reasons.some(s => s.includes("No response history"))).toBe(true);
  });

  it("gives the universal O- donor the top blood bonus", () => {
    const r = scoreDonorForSos({ ...baseDonor, bloodGroup: "O-" }, { ...baseSos, bloodGroup: "AB+" }, baseHospital, noHistory);
    expect(r.reasons.some(s => s.includes("Universal O- donor (+40)"))).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it("excludes incompatible blood types with an honest reason", () => {
    // A+ cannot donate to O-.
    const r = scoreDonorForSos({ ...baseDonor, bloodGroup: "A+" }, { ...baseSos, bloodGroup: "O-" }, baseHospital, noHistory);
    expect(r.score).toBe(0);
    expect(r.reasons[0]).toContain("cannot donate");
    const ranked = rankDonorsForSos([baseDonor], { ...baseSos, bloodGroup: "O-" }, baseHospital, {});
    expect(ranked).toHaveLength(0);
  });

  it("rewards proximity with bigger points for closer donors", () => {
    const near = scoreDonorForSos(
      { ...baseDonor, latitude: 33.700, longitude: 73.020 },
      baseSos,
      { ...baseHospital, latitude: 33.700, longitude: 73.020 },
      noHistory
    );
    const far = scoreDonorForSos(
      { ...baseDonor, latitude: 33.900, longitude: 73.300 },
      baseSos,
      { ...baseHospital, latitude: 33.700, longitude: 73.020 },
      noHistory
    );
    const nearKm = parseFloat(near.reasons.find(s => s.includes("km"))!.split(" ")[0]);
    const farKm = parseFloat(far.reasons.find(s => s.includes("km"))!.split(" ")[0]);
    expect(farKm).toBeGreaterThan(nearKm);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it("scores future eligibility honestly (0, +5 within a week)", () => {
    const ineligible = scoreDonorForSos(
      { ...baseDonor, nextEligibleDate: "2099-01-01" },
      baseSos,
      baseHospital,
      noHistory
    );
    expect(ineligible.reasons.some(s => s.includes("Not yet eligible"))).toBe(true);
    expect(ineligible.reasons.some(s => s.includes("Eligible to donate now"))).toBe(false);

    const week = scoreDonorForSos(
      { ...baseDonor, nextEligibleDate: new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0] },
      baseSos,
      baseHospital,
      noHistory
    );
    expect(week.reasons.some(s => s.includes("Eligible again in 3 days (+5)"))).toBe(true);
  });

  it("converts response history into the right points (3 of 4 → +7)", () => {
    const stats = { accepted: 3, declined: 1, expired: 0, superseded: 2 };
    const r = scoreDonorForSos(baseDonor, baseSos, baseHospital, stats);
    expect(r.reasons.some(s => s.includes("Responded to 3 of 4 requests (75%) (+7)"))).toBe(true);
  });

  it("sorts ranked matches by score descending", () => {
    const donors = [
      { ...baseDonor, id: "low", latitude: 34.5, longitude: 74.0, nextEligibleDate: "2099-01-01" },
      { ...baseDonor, id: "high" },
    ];
    const ranked = rankDonorsForSos(donors, baseSos, baseHospital, {});
    expect(ranked.map(r => r.donor.id)).toEqual(["high", "low"]);
  });

  it("drops unavailable donors from the ranked list", () => {
    const ranked = rankDonorsForSos([{ ...baseDonor, isAvailable: false }], baseSos, baseHospital, {});
    expect(ranked).toHaveLength(0);
  });
});
