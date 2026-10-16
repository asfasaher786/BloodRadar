import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { loginAs, uniquePhone } from "./helpers";

// Organization portal (Phase 3): a verified phone applies as an NGO or
// hospital org; an admin approves it; approved orgs post SOS on behalf of
// patients, close their own requests, and (hospitals only) update blood-bank
// stock with timestamps. One org per phone. Nothing here works unapproved.

const ADMIN_PHONE = "+923331234567";

async function applyOrg(app: any, agent: any, body: Record<string, any>) {
  return agent.post("/api/orgs/apply").send(body);
}

async function approveOrg(app: any, orgId: string) {
  const { agent: adminAgent } = await loginAs(app, ADMIN_PHONE);
  return adminAgent.post(`/api/admin/orgs/${orgId}/approve`);
}

describe("Organization application (Phase 3)", () => {
  it("requires login to apply (401) and validates the payload", async () => {
    const app = createApp();
    const unauth = await request(app).post("/api/orgs/apply").send({ name: "X", type: "ngo" });
    expect(unauth.status).toBe(401);

    const { agent } = await loginAs(app, uniquePhone());
    const bad = await applyOrg(app, agent, { name: "A", type: "unknown" });
    expect(bad.status).toBe(400);
  });

  it("creates a pending application, shows it in /me, and blocks a second one (409)", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const { agent } = await loginAs(app, phone);

    const created = await applyOrg(app, agent, { name: "Shifa Foundation", type: "ngo", city: "Islamabad" });
    expect(created.status).toBe(201);
    expect(created.body.org.status).toBe("pending");
    expect(created.body.org.type).toBe("ngo");
    expect(created.body.org.city).toBe("Islamabad");

    const me = await agent.get("/api/orgs/me");
    expect(me.status).toBe(200);
    expect(me.body.org.id).toBe(created.body.org.id);

    const dup = await applyOrg(app, agent, { name: "Shifa Foundation Again", type: "ngo" });
    expect(dup.status).toBe(409);
    expect(dup.body.org.id).toBe(created.body.org.id);
  });

  it("hospital applications must link a hospital from the directory", async () => {
    const app = createApp();
    const { agent } = await loginAs(app, uniquePhone());

    const noHospital = await applyOrg(app, agent, { name: "City Blood Bank", type: "hospital" });
    expect(noHospital.status).toBe(400);

    const wrongHospital = await applyOrg(app, agent, { name: "City Blood Bank", type: "hospital", hospitalId: "hosp-nope" });
    expect(wrongHospital.status).toBe(400);

    const ok = await applyOrg(app, agent, { name: "PIMS Blood Bank", type: "hospital", hospitalId: "hosp-1" });
    expect(ok.status).toBe(201);
    expect(ok.body.org.hospitalName).toContain("PIMS");
  });

  it("an unapproved applicant keeps the donor role at login", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const { agent } = await loginAs(app, phone);
    await applyOrg(app, agent, { name: "Pending NGO", type: "ngo" });

    const { user } = await loginAs(app, phone);
    expect(user.role).toBe("donor");
  });
});

describe("Admin approval (Phase 3)", () => {
  it("only admins can list and approve orgs; approval is audited and grants the role", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const { agent: memberAgent } = await loginAs(app, phone);
    const created = await applyOrg(app, memberAgent, { name: "Red Crescent Unit", type: "ngo" });
    const orgId = created.body.org.id;

    // Non-admin cannot list or approve.
    const denied = await memberAgent.get("/api/admin/orgs");
    expect(denied.status).toBe(403);
    const deniedApprove = await memberAgent.post(`/api/admin/orgs/${orgId}/approve`);
    expect(deniedApprove.status).toBe(403);

    // Admin lists applications, approves this one.
    const { agent: adminAgent } = await loginAs(app, ADMIN_PHONE);
    const list = await adminAgent.get("/api/admin/orgs");
    expect(list.status).toBe(200);
    expect(list.body.some((o: any) => o.id === orgId)).toBe(true);

    const approved = await adminAgent.post(`/api/admin/orgs/${orgId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.org.status).toBe("approved");
    expect(approved.body.org.reviewedAt).toBeTruthy();

    // Already decided — no double approve.
    const again = await adminAgent.post(`/api/admin/orgs/${orgId}/approve`);
    expect(again.status).toBe(409);

    // Audit trail records the decision.
    const audit = await adminAgent.get("/api/admin/audit");
    expect(audit.body.some((e: any) => e.action === "org_approved" && e.detail.includes("Red Crescent Unit"))).toBe(true);

    // The member's next login carries the org role.
    const { user } = await loginAs(app, phone);
    expect(user.role).toBe("ngo");
  });

  it("rejection is terminal and grants no role", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const { agent: memberAgent } = await loginAs(app, phone);
    const created = await applyOrg(app, memberAgent, { name: "Fake NGO", type: "ngo" });
    const orgId = created.body.org.id;

    const { agent: adminAgent } = await loginAs(app, ADMIN_PHONE);
    const rejected = await adminAgent.post(`/api/admin/orgs/${orgId}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.org.status).toBe("rejected");

    const { user } = await loginAs(app, phone);
    expect(user.role).toBe("donor");
  });
});

describe("Organization SOS posting (Phase 3)", () => {
  it("an approved org's SOS is labelled, and the org can close it (audited)", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const { agent: memberAgent } = await loginAs(app, phone);
    const created = await applyOrg(app, memberAgent, { name: "Hope Foundation", type: "ngo" });
    await approveOrg(app, created.body.org.id);

    // Refresh so the session's role reflects the freshly approved org.
    const refreshed = await memberAgent.post("/api/auth/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe("ngo");

    // Post on behalf of a patient — same org desk phone, same group, twice:
    // orgs legitimately post for different patients, so no duplicate trap.
    for (const patient of ["Patient One", "Patient Two"]) {
      const post = await memberAgent.post("/api/emergencies").send({
        patientName: patient,
        bloodGroup: "O+",
        unitsNeeded: 1,
        contactPhone: phone,
        reason: "Road accident, surgery scheduled",
        urgency: "Urgent",
        city: "Islamabad",
      });
      expect(post.status).toBe(200);
      expect(post.body.request.postedBy).toBe("organization");
      expect(post.body.request.orgName).toBe("Hope Foundation");
      expect(post.body.request.orgId).toBe(created.body.org.id);
    }

    // The public board carries the org label and still masks the phone.
    const board = await request(app).get("/api/emergencies");
    const mine = board.body.filter((s: any) => s.orgName === "Hope Foundation");
    expect(mine.length).toBe(2);
    expect(mine[0].contactPhone).toContain("••••");
    expect(mine[0].requesterCode).toBeUndefined();

    // The org's own requests list contains exactly these two.
    const mineRes = await memberAgent.get("/api/orgs/requests");
    expect(mineRes.status).toBe(200);
    expect(mineRes.body.length).toBe(2);
    expect(mineRes.body.every((s: any) => s.requesterCode === undefined)).toBe(true);

    // Close one: org-authorized, audited as an org action.
    const close = await memberAgent.patch(`/api/emergencies/${mine[0].id}/status`).send({ status: "Fulfilled" });
    expect(close.status).toBe(200);
    expect(close.body.request.status).toBe("Fulfilled");

    const { agent: adminAgent } = await loginAs(app, ADMIN_PHONE);
    const audit = await adminAgent.get("/api/admin/audit");
    expect(audit.body.some((e: any) => e.action === "sos_fulfilled_by_org")).toBe(true);
  });

  it("another org (and anonymous visitors) cannot close someone else's request", async () => {
    const app = createApp();
    const phoneA = uniquePhone();
    const { agent: agentA } = await loginAs(app, phoneA);
    const orgA = await applyOrg(app, agentA, { name: "Org A", type: "ngo" });
    await approveOrg(app, orgA.body.org.id);
    await agentA.post("/api/auth/refresh");

    const post = await agentA.post("/api/emergencies").send({
      patientName: "Org A Patient",
      bloodGroup: "B+",
      contactPhone: phoneA,
      city: "Islamabad",
    });
    const sosId = post.body.request.id;

    // A second, unrelated approved org.
    const phoneB = uniquePhone();
    const { agent: agentB } = await loginAs(app, phoneB);
    const orgB = await applyOrg(app, agentB, { name: "Org B", type: "ngo" });
    await approveOrg(app, orgB.body.org.id);
    await agentB.post("/api/auth/refresh");

    const denied = await agentB.patch(`/api/emergencies/${sosId}/status`).send({ status: "Fulfilled" });
    expect(denied.status).toBe(403);

    // Anonymous (no valid requester code) also cannot.
    const anon = await request(app).patch(`/api/emergencies/${sosId}/status`).send({ status: "Fulfilled" });
    expect(anon.status).toBe(403);

    // Unapproved orgs get no privilege either: the same request from a
    // pending-application phone is just a donor.
    const phoneC = uniquePhone();
    const { agent: agentC } = await loginAs(app, phoneC);
    await applyOrg(app, agentC, { name: "Org C pending", type: "ngo" });
    const deniedPending = await agentC.patch(`/api/emergencies/${sosId}/status`).send({ status: "Fulfilled" });
    expect(deniedPending.status).toBe(403);
  });
});

describe("Blood-bank stock updates (Phase 3)", () => {
  async function setupHospitalOrg(app: any) {
    const phone = uniquePhone();
    const { agent } = await loginAs(app, phone);
    const created = await applyOrg(app, agent, { name: "PIMS Blood Bank", type: "hospital", hospitalId: "hosp-1" });
    await approveOrg(app, created.body.org.id);
    await agent.post("/api/auth/refresh");
    return { agent, phone };
  }

  it("the approved hospital org updates stock with a real timestamp (partial merge)", async () => {
    const app = createApp();
    const { agent } = await setupHospitalOrg(app);

    const before = (await request(app).get("/api/hospitals")).body.find((h: any) => h.id === "hosp-1");
    const beforeO = before.bloodAvailability["O-"];

    const res = await agent.put("/api/hospitals/hosp-1/stock").send({ availability: { "O+": "Critical" } });
    expect(res.status).toBe(200);
    expect(res.body.hospital.bloodAvailability["O+"]).toBe("Critical");
    expect(res.body.hospital.bloodAvailability["O-"]).toBe(beforeO); // untouched
    expect(res.body.hospital.stockLastUpdated).toBe(new Date().toISOString().split("T")[0]);

    // The public hospital list now carries the updated, timestamped stock.
    const after = (await request(app).get("/api/hospitals")).body.find((h: any) => h.id === "hosp-1");
    expect(after.bloodAvailability["O+"]).toBe("Critical");
    expect(after.stockLastUpdated).toBe(new Date().toISOString().split("T")[0]);
  });

  it("rejects invalid payloads, wrong hospitals, NGOs and anonymous callers", async () => {
    const app = createApp();
    const { agent } = await setupHospitalOrg(app);

    const badGroup = await agent.put("/api/hospitals/hosp-1/stock").send({ availability: { "Z+": "Low" } });
    expect(badGroup.status).toBe(400);
    const badLevel = await agent.put("/api/hospitals/hosp-1/stock").send({ availability: { "O+": "Banana" } });
    expect(badLevel.status).toBe(400);
    const empty = await agent.put("/api/hospitals/hosp-1/stock").send({ availability: {} });
    expect(empty.status).toBe(400);

    // Linked to hosp-1 — cannot touch hosp-2.
    const wrongHospital = await agent.put("/api/hospitals/hosp-2/stock").send({ availability: { "O+": "Low" } });
    expect(wrongHospital.status).toBe(403);

    // An approved NGO cannot update any stock.
    const ngoPhone = uniquePhone();
    const { agent: ngoAgent } = await loginAs(app, ngoPhone);
    const ngoOrg = await applyOrg(app, ngoAgent, { name: "Aid NGO", type: "ngo" });
    await approveOrg(app, ngoOrg.body.org.id);
    await ngoAgent.post("/api/auth/refresh");
    const ngoDenied = await ngoAgent.put("/api/hospitals/hosp-1/stock").send({ availability: { "O+": "Low" } });
    expect(ngoDenied.status).toBe(403);

    const anon = await request(app).put("/api/hospitals/hosp-1/stock").send({ availability: { "O+": "Low" } });
    expect(anon.status).toBe(401);
  });

  it("stock updates land in the audit trail", async () => {
    const app = createApp();
    const { agent } = await setupHospitalOrg(app);
    await agent.put("/api/hospitals/hosp-1/stock").send({ availability: { "AB-": "In Stock" } });

    const { agent: adminAgent } = await loginAs(app, ADMIN_PHONE);
    const audit = await adminAgent.get("/api/admin/audit");
    expect(audit.body.some((e: any) => e.action === "stock_updated" && e.detail.includes("PIMS"))).toBe(true);
  });
});
