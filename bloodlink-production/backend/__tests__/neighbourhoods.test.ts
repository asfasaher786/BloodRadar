import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, createSos } from "./helpers";
import { getNeighbourhoodsForCity, resolveNeighbourhood } from "../config/neighbourhoods";
import { haversineKm } from "../lib/geo";

// P2-4: consented coarse locations. The dropdown sends a neighbourhood NAME
// only; the server resolves it to a centroid for distance-based ranking.
// Street addresses never enter the system.

describe("P2-4 neighbourhood resolution", () => {
  it("matches dropdown values case-insensitively to centroids", () => {
    const g10 = resolveNeighbourhood("Islamabad", "g-10");
    expect(g10).not.toBeNull();
    expect(g10!.latitude).toBeCloseTo(33.6805, 4);
    expect(g10!.longitude).toBeCloseTo(73.04, 4);

    const saddar = resolveNeighbourhood("Rawalpindi", " SADDAR ");
    expect(saddar).not.toBeNull();
    expect(saddar!.latitude).toBeCloseTo(33.6007, 4);
  });

  it("returns null for unknown, empty or wrong-city names (city-centre fallback)", () => {
    expect(resolveNeighbourhood("Islamabad", "G-10/4 Street 7")).toBeNull();
    expect(resolveNeighbourhood("Islamabad", "")).toBeNull();
    expect(resolveNeighbourhood("Islamabad", "Saddar")).toBeNull();
    expect(resolveNeighbourhood("Lahore", "G-10")).toBeNull();
  });

  it("lists every supported neighbourhood per city", () => {
    expect(getNeighbourhoodsForCity("Islamabad")).toHaveLength(20);
    expect(getNeighbourhoodsForCity("Rawalpindi")).toHaveLength(15);
    expect(getNeighbourhoodsForCity("Karachi")).toEqual([]);
  });
});

describe("P2-4 haversine distance", () => {
  it("measures real kilometres between centroids", () => {
    const g10 = resolveNeighbourhood("Islamabad", "G-10")!;
    const f6 = resolveNeighbourhood("Islamabad", "F-6")!;
    const bharaKahu = resolveNeighbourhood("Islamabad", "Bhara Kahu")!;

    const near = haversineKm(g10.latitude, g10.longitude, f6.latitude, f6.longitude)!;
    const far = haversineKm(g10.latitude, g10.longitude, bharaKahu.latitude, bharaKahu.longitude)!;
    // G-10 → F-6 is a few km; G-10 → Bhara Kahu is much further.
    expect(near).toBeGreaterThan(3);
    expect(near).toBeLessThan(8);
    expect(far).toBeGreaterThan(near);
  });

  it("returns null when any coordinate is missing", () => {
    expect(haversineKm(undefined as unknown as number, 73.04, 33.7, 73.0)).toBeNull();
    expect(haversineKm(33.7, 73.04, NaN, 73.0)).toBeNull();
  });
});

describe("P2-4 registration and SOS anchoring (in-memory DB)", () => {
  it("stores the neighbourhood centroid for a donor registering with an area", async () => {
    const app = createApp();
    const { user } = await registerDonor(app, { area: "G-10" });
    expect(user.donor.area).toBe("G-10");
    expect(user.donor.latitude).toBeCloseTo(33.6805, 4);
    expect(user.donor.longitude).toBeCloseTo(73.04, 4);
  });

  it("keeps unknown area text as display name and still assigns coordinates", async () => {
    const app = createApp();
    const { user } = await registerDonor(app, { area: "Some Street 12" });
    expect(user.donor.area).toBe("Some Street 12");
    expect(typeof user.donor.latitude).toBe("number");
    expect(typeof user.donor.longitude).toBe("number");
  });

  it("stores the neighbourhood on the SOS and ranks the nearer donor first", async () => {
    const app = createApp();
    await registerDonor(app, { name: "Near Donor", area: "G-10", bloodGroup: "O-" });
    await registerDonor(app, { name: "Far Donor", area: "Bhara Kahu", bloodGroup: "O-" });

    const sos = await createSos(app, { bloodGroup: "O-", neighbourhood: "G-10" });
    expect(sos.request.neighbourhood).toBe("G-10");
    expect(typeof sos.request.latitude).toBe("number");
    expect(sos.request.latitude).toBeCloseTo(33.6805, 4);

    const res = await request(app).get(`/api/emergencies/${sos.request.id}/matches`);
    expect(res.status).toBe(200);
    const matches = res.body.matches as Array<{ name: string; score: number }>;
    const near = matches.find((m) => m.name === "Near Donor");
    const far = matches.find((m) => m.name === "Far Donor");
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    // Distance points push the G-10 donor above the Bhara Kahu donor.
    expect(near!.score).toBeGreaterThan(far!.score);
  });
});
