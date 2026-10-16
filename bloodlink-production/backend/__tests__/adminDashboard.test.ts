import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { loginAs, createSos, uniquePhone } from "./helpers";

// Admin dashboard (Phase 3): moderation queue for reported SOS, the North
// Star metric (units delivered, real vs sample split, never fabricated),
// and an anonymized CSV export. Everything here is admin-only.

const ADMIN_PHONE = "+923331234567";

describe("Moderation queue (Phase 3)", () => {
  it("reported SOS appear to admins with reports and no requesterCode", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app, { bloodGroup: "AB+" });

    const report = await request(app)
      .post(`/api/emergencies/${sos.id}/report`)
      .send({ reason: "Looks like a fake request" });
    expect(report.status).toBe(200);

    // Non-admin: denied.
    const stranger = await loginAs(app, uniquePhone());
    const denied = await stranger.agent.get("/api/admin/reported");
    expect(denied.status).toBe(403);

    // Admin: sees it with the reports attached.
    const { agent: admin } = await loginAs(app, ADMIN_PHONE);
    const list = await admin.get("/api/admin/reported");
    expect(list.status).toBe(200);
    const entry = list.body.find((e: any) => e.id === sos.id);
    expect(entry).toBeTruthy();
    expect(entry.reports.length).toBe(1);
    expect(entry.reports[0].reason).toBe("Looks like a fake request");
    expect(entry.requesterCode).toBeUndefined();
  });

  it("dismissing clears the reports and leaves the queue (audited)", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app);
    await request(app).post(`/api/emergencies/${sos.id}/report`).send({ reason: "spam?" });

    const { agent: admin } = await loginAs(app, ADMIN_PHONE);

    const dismissed = await admin.post(`/api/admin/reported/${sos.id}/dismiss`);
    expect(dismissed.status).toBe(200);

    const list = await admin.get("/api/admin/reported");
    expect(list.body.some((e: any) => e.id === sos.id)).toBe(false);

    const audit = await admin.get("/api/admin/audit");
    expect(audit.body.some((e: any) => e.action === "sos_report_dismissed" && e.sosId === sos.id)).toBe(true);
  });
});

describe("North Star metric (Phase 3)", () => {
  it("counts delivered units from fulfilled requests, split real vs sample", async () => {
    const app = createApp();

    // A real request (no isSample flag) — 2 units, fulfilled by requester code.
    const { request: sos, requesterCode } = await createSos(app, { bloodGroup: "B+" });
    const fulfill = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Fulfilled", requesterCode });
    expect(fulfill.status).toBe(200);
    expect(fulfill.body.request.fulfilledAt).toBeTruthy();

    // Another real request, 1 unit, still pending — must not count.
    await createSos(app, { bloodGroup: "A+" });

    // A pending org application should surface in the dashboard activity.
    const orgPhone = uniquePhone();
    const { agent: orgAgent } = await loginAs(app, orgPhone);
    await orgAgent.post("/api/orgs/apply").send({ name: "Metric NGO", type: "ngo" });

    const { agent: admin } = await loginAs(app, ADMIN_PHONE);
    const metrics = await admin.get("/api/admin/metrics");
    expect(metrics.status).toBe(200);

    // unitsNeeded for the fulfilled request was 1 (helper default)... ensure the
    // delivered number equals the sum of units on fulfilled REAL requests.
    const m = metrics.body;
    expect(m.northStar.fulfilledReal).toBe(1);
    expect(m.northStar.unitsDeliveredReal).toBe(1);
    // Seeded SOS are sample data and still pending — they never inflate the
    // delivered number.
    expect(m.northStar.unitsDeliveredIncludingSample).toBe(1);
    expect(m.activity.pendingOrgApplications).toBe(1);
    // No accepted contact requests yet — the median must be null, not a guess.
    expect(m.medianTimeToFirstContactMs).toBeNull();
  });
});

describe("Anonymized CSV export (Phase 3)", () => {
  it("exports SOS rows without names or phone numbers (admin-only)", async () => {
    const app = createApp();
    const requesterPhone = uniquePhone();
    const { request: sos } = await createSos(app, { contactPhone: requesterPhone });

    // Non-admin denied.
    const stranger = await loginAs(app, uniquePhone());
    const denied = await stranger.agent.get("/api/admin/export.csv");
    expect(denied.status).toBe(403);

    const { agent: admin } = await loginAs(app, ADMIN_PHONE);
    const csv = await admin.get("/api/admin/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");

    const body = csv.text;
    // The row for our SOS exists with its aggregate fields.
    expect(body).toContain(sos.id);
    expect(body).toContain(sos.bloodGroup);
    expect(body).toContain("requester");
    // The patient name and the real phone number are NOT in the export.
    expect(body).not.toContain("Test Patient");
    expect(body).not.toContain(requesterPhone);
    // Header carries the promised columns.
    expect(body.split("\n")[0]).toBe(
      "id,createdAt,fulfilledAt,bloodGroup,unitsNeeded,city,hospitalName,urgency,status,postedBy,isSample"
    );
  });
});
