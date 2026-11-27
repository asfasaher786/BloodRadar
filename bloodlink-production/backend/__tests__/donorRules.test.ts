import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor } from "./helpers";

describe("donor privacy on public listings", () => {
  it("masks every donor phone and flags them as masked", async () => {
    const app = createApp();
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const d of res.body) {
      expect(d.phoneMasked).toBe(true);
      expect(d.phone).toContain("••••");
      // A masked number can never start a tel: call — no full digits leaked.
      expect(d.phone.replace(/\D/g, "").length).toBeLessThan(12);
    }
  });

  it("returns only the allow-listed fields (P2-7): no coordinates, full names or dates", async () => {
    const app = createApp();
    const res = await request(app).get("/api/donors");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const d of res.body) {
      // Forbidden keys never appear on the public list.
      expect(d).not.toHaveProperty("latitude");
      expect(d).not.toHaveProperty("longitude");
      expect(d).not.toHaveProperty("location");
      expect(d).not.toHaveProperty("lastDonationDate");
      expect(d).not.toHaveProperty("nextEligibleDate");
      expect(d).not.toHaveProperty("createdAt");
      expect(d).not.toHaveProperty("reviews");
      // The allow-list is present.
      expect(d).toHaveProperty("id");
      expect(d).toHaveProperty("name");
      expect(d).toHaveProperty("bloodGroup");
      expect(d).toHaveProperty("city");
      expect(d).toHaveProperty("area");
      expect(d).toHaveProperty("isAvailable");
      expect(d).toHaveProperty("isVerified");
      expect(d).toHaveProperty("reviewsSummary");
      // Full names never appear: at most "Firstname L." (two tokens).
      const parts = d.name.trim().split(/\s+/);
      expect(parts.length).toBeLessThanOrEqual(2);
      if (parts.length === 2) expect(parts[1]).toMatch(/^[A-Z]\.$/);
      // Review content (patient names, comments) stays off the list.
      expect(JSON.stringify(d)).not.toContain("patientName");
      expect(JSON.stringify(d)).not.toContain("comment");
    }
  });
});

describe("donor self-service (session identity, never body identity)", () => {
  it("401s toggle-availability and log-donation without a session", async () => {
    const app = createApp();
    const toggle = await request(app)
      .post("/api/donors/toggle-availability")
      .send({ isAvailable: false });
    expect(toggle.status).toBe(401);

    const log = await request(app).post("/api/donors/log-donation").send({});
    expect(log.status).toBe(401);
  });

  it("ignores any body-supplied phone and acts on the session", async () => {
    const app = createApp();
    const { agent, phone } = await registerDonor(app);

    // Even with a WRONG phone in the body, the server uses the session —
    // and returns a masked phone in the response.
    const toggle = await agent
      .post("/api/donors/toggle-availability")
      .send({ isAvailable: false, phone: "+920000000000" });
    expect(toggle.status).toBe(200);
    expect(toggle.body.donor.phone).toContain("••••");
    expect(toggle.body.donor.isAvailable).toBe(false);

    const me = await agent.get("/api/auth/me");
    expect(me.body.user.phone).toBe(phone);
    expect(me.body.user.donor.isAvailable).toBe(false);
  });

  it("enforces the 90-day gap between logged donations", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);

    const first = await agent.post("/api/donors/log-donation");
    expect(first.status).toBe(200);
    expect(first.body.donor.stats.donationsCount).toBe(1);
    // The response carries the computed next-eligibility date.
    expect(first.body.donor.nextEligibleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const second = await agent.post("/api/donors/log-donation");
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/days/);
  });

  it("validates reviews and rejects out-of-range ratings", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);
    const me = await agent.get("/api/auth/me");
    const donorId = me.body.user.donor.id;

    const good = await request(app).post(`/api/donors/${donorId}/reviews`).send({
      patientName: "Grateful Patient",
      rating: 5,
      comment: "Reached in 20 minutes. Life saver.",
    });
    expect(good.status).toBe(200);
    // P2-7: the POST response never echoes the full donor object.
    expect(good.body).not.toHaveProperty("donor");

    const bad = await request(app).post(`/api/donors/${donorId}/reviews`).send({
      rating: 9,
      comment: "invalid",
    });
    expect(bad.status).toBe(400);
  });

  it("scrubs reviewer names on the per-donor reviews endpoint (P2-7)", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);
    const me = await agent.get("/api/auth/me");
    const donorId = me.body.user.donor.id;

    await request(app).post(`/api/donors/${donorId}/reviews`).send({
      patientName: "Grateful Patient",
      rating: 5,
      comment: "Reached in 20 minutes. Life saver.",
    });

    const res = await request(app).get(`/api/donors/${donorId}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.reviews.length).toBe(1);
    const rev = res.body.reviews[0];
    // Full third-party names never leave the server: "Grateful P." at most.
    expect(rev.patientName).toBe("Grateful P.");
    expect(JSON.stringify(res.body)).not.toContain("Grateful Patient");
    expect(rev).not.toHaveProperty("phone");

    // Unknown donors 404 instead of leaking a roster.
    const missing = await request(app).get("/api/donors/nope/reviews");
    expect(missing.status).toBe(404);
  });

  it("returns the donor inbox only to donor sessions", async () => {
    const app = createApp();
    const anon = await request(app).get("/api/donors/inbox");
    expect(anon.status).toBe(401);

    const { agent } = await registerDonor(app);
    const inbox = await agent.get("/api/donors/inbox");
    expect(inbox.status).toBe(200);
    expect(Array.isArray(inbox.body)).toBe(true);
  });
});
