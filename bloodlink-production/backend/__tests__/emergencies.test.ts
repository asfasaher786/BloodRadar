import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, loginAs, createSos, uniquePhone } from "./helpers";

// Privacy contract: public SOS and donor listings never contain a full phone
// number. The requester's one-time code is their only credential. Contact
// reveal happens only through the explicit accept flow, and every step of it
// lands in an admin-only audit trail.

describe("SOS creation and masking", () => {
  it("masks the requester phone and keeps requesterCode out of the public payload", async () => {
    const app = createApp();
    const requesterPhone = uniquePhone();
    const { request: sos, requesterCode } = await createSos(app, { contactPhone: requesterPhone });

    expect(sos.phoneMasked).toBe(true);
    expect(sos.contactPhone).not.toContain(requesterPhone.replace("+", ""));
    expect(sos.contactPhone).toContain("••••");
    expect(sos.requesterCode).toBeUndefined();
    expect(requesterCode).toMatch(/^[0-9a-f]{12}$/);
    expect(typeof sos.matchingDonorsCount).toBe("number");
  });

  it("strips requesterCode from the public board too", async () => {
    const app = createApp();
    await createSos(app);
    const res = await request(app).get("/api/emergencies");
    expect(res.status).toBe(200);
    for (const sos of res.body) {
      expect(sos.requesterCode).toBeUndefined();
      expect(sos.contactPhone).toContain("••••");
    }
  });

  it("rejects invalid blood groups with 400 (zod)", async () => {
    const app = createApp();
    const res = await request(app).post("/api/emergencies").send({
      bloodGroup: "XX",
      contactPhone: uniquePhone(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("rejects contact-request and reveal with a wrong requester code", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app);

    const contactRes = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode: "deadbeefdead" });
    expect(contactRes.status).toBe(403);

    const revealRes = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=deadbeefdead`);
    expect(revealRes.status).toBe(403);
  });

  it("lets the requester cancel their own SOS but nobody else", async () => {
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    // No code at all → 403
    const noCode = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Cancelled" });
    expect(noCode.status).toBe(403);

    // Wrong code → 403
    const wrongCode = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Cancelled", requesterCode: "deadbeefdead" });
    expect(wrongCode.status).toBe(403);

    // Requester may mark fulfilled (blood arrived) — audited for honest stats.
    const fulfilled = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Fulfilled", requesterCode });
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.request.status).toBe("Fulfilled");

    const cancelled = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Cancelled", requesterCode });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.request.status).toBe("Cancelled");
  });
});

describe("contact-reveal end to end", () => {
  it("notifies matching donors, first accept wins, both sides get real numbers", async () => {
    const app = createApp();

    // Two O- donors in Islamabad → both match an O- patient there.
    const donorA = await registerDonor(app, { name: "Donor Alpha", bloodGroup: "O-", city: "Islamabad" });
    const donorB = await registerDonor(app, { name: "Donor Beta", bloodGroup: "O-", city: "Islamabad" });

    const requesterPhone = uniquePhone();
    const { request: sos, requesterCode } = await createSos(app, {
      contactPhone: requesterPhone,
      bloodGroup: "O-",
      city: "Islamabad",
    });

    // Requester asks the platform to notify donors (proven by their code).
    const notifyRes = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode });
    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.notifiedDonors).toBeGreaterThanOrEqual(2);

    // Both donors see the request in their inboxes with a MASKED requester.
    const inboxA = await donorA.agent.get("/api/donors/inbox");
    expect(inboxA.status).toBe(200);
    const itemA = inboxA.body.find((i: any) => i.sosId === sos.id);
    expect(itemA).toBeTruthy();
    expect(itemA.status).toBe("open");
    expect(itemA.requesterPhone).toContain("••••");
    expect(itemA.phoneRevealed).toBe(false);

    // Reveal is still "waiting" before anyone accepts.
    const waiting = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe("waiting");

    // Donor A accepts → gets the full requester number.
    const acceptRes = await donorA.agent.post(`/api/donors/inbox/${itemA.id}/accept`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.requesterPhone).toBe(requesterPhone);

    // Requester's reveal now shows donor A's real number.
    const revealed = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(revealed.status).toBe(200);
    expect(revealed.body.status).toBe("fulfilled");
    expect(revealed.body.donor.phone).toBe(donorA.phone);
    expect(revealed.body.donor.name).toBe("Donor Alpha");

    // Donor B's copy of the request is superseded (first accept wins).
    const inboxB = await donorB.agent.get("/api/donors/inbox");
    const itemB = inboxB.body.find((i: any) => i.sosId === sos.id);
    expect(itemB.status).toBe("superseded");

    // The whole exchange is in the admin-only audit trail.
    const admin = await loginAs(app, "+923331234567");
    const auditRes = await admin.agent.get("/api/admin/audit");
    expect(auditRes.status).toBe(200);
    const actions = auditRes.body.map((e: any) => e.action);
    expect(actions).toContain("sos_created");
    expect(actions).toContain("contact_request_accepted");
  });

  it("gates the audit trail: 401 anonymous, 403 for ordinary donors", async () => {
    const app = createApp();

    const anon = await request(app).get("/api/admin/audit");
    expect(anon.status).toBe(401);

    const donor = await registerDonor(app);
    const donorRes = await donor.agent.get("/api/admin/audit");
    expect(donorRes.status).toBe(403);
  });

  it("lets an admin delete an SOS", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app);
    const admin = await loginAs(app, "+923331234567");

    const del = await admin.agent.delete(`/api/emergencies/${sos.id}`);
    expect(del.status).toBe(200);

    const gone = await request(app).get("/api/emergencies");
    expect(gone.body.find((e: any) => e.id === sos.id)).toBeUndefined();
  });
});
