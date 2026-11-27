import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";

// P3b-3: the ML/urgency lab endpoints are admin-only. They expose aggregate
// emergency statistics and donor-location clustering — operational telemetry
// the public has no business seeing, and donor locations even less so.

describe("ML lab endpoints are admin-only (P3b-3)", () => {
  const app = createApp();

  it("rejects anonymous callers with 401", async () => {
    const res = await request(app).get("/api/ml/real-status");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin donor with 403", async () => {
    const { registerDonor } = await import("./helpers");
    const { agent } = await registerDonor(app, { bloodGroup: "B+", city: "Islamabad" });
    const res = await agent.get("/api/ml/real-status");
    expect(res.status).toBe(403);
  });

  it("blocks anonymous access to the urgency classifier and donor clustering too", async () => {
    const classify = await request(app).post("/api/ml/real-classify-urgency").send({ text: "urgent blood needed" });
    expect(classify.status).toBe(401);
    const cluster = await request(app).get("/api/ml/real-donor-clustering?k=3");
    expect(cluster.status).toBe(401);
  });

  it("allows the admin and returns the honest status shape", async () => {
    const { loginAs } = await import("./helpers");
    const { agent } = await loginAs(app, "+923331234567"); // dev demo admin
    const res = await agent.get("/api/ml/real-status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalRealRequests");
    expect(res.body).toHaveProperty("labeledExamples");
    expect(res.body).toHaveProperty("isTrained");
    expect(res.body).toHaveProperty("minRequired");
  });
});
