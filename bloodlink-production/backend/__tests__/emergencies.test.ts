import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, loginAs, createSos, uniquePhone, requestProof } from "./helpers";

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

  it("rejects NoSQL operator payloads with 400 (zod types, never raw filters)", async () => {
    const app = createApp();
    // MongoDB query operators smuggled in as values must never reach a
    // filter: zod requires plain strings here, so both shapes get a 400.
    const opPhone = await request(app).post("/api/emergencies").send({
      bloodGroup: "O+",
      contactPhone: { $ne: null },
    });
    expect(opPhone.status).toBe(400);

    const opGroup = await request(app).post("/api/emergencies").send({
      bloodGroup: { $gt: "" },
      contactPhone: uniquePhone(),
    });
    expect(opGroup.status).toBe(400);
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

describe("Abuse controls (Phase 3)", () => {
  it("answers a duplicate SOS with duplicate:true instead of double-posting", async () => {
    const app = createApp();
    const phone = uniquePhone();

    const first = await createSos(app, { contactPhone: phone, bloodGroup: "B-" });
    // P0-1: the duplicate re-submit must still present a valid proof —
    // one proof token covers several posts within its 15-minute lifetime.
    const proofToken = await requestProof(app, phone);
    const again = await request(app).post("/api/emergencies").send({
      bloodGroup: "B-",
      contactPhone: phone,
      proofToken,
    });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.success).toBe(false);
    expect(again.body.request.id).toBe(first.request.id);
    // The one-time code is never re-issued in a duplicate response.
    expect(again.body.requesterCode).toBeUndefined();
    expect(again.body.request.requesterCode).toBeUndefined();

    // Same phone, different blood group is a NEW need (e.g. another
    // family member) — not a duplicate.
    const other = await createSos(app, { contactPhone: phone, bloodGroup: "A+" });
    expect(other.request.id).not.toBe(first.request.id);
  });

  it("caps a phone at 3 SOS per 24 hours with an honest 429", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const groups = ["O-", "B-", "A+"];

    for (const g of groups) {
      const res = await createSos(app, { contactPhone: phone, bloodGroup: g });
      expect(res.request.id).toBeTruthy();
    }

    // P0-1: the proof check passes (valid token) — the 429 comes from the
    // per-phone cap, not from missing verification.
    const proofToken = await requestProof(app, phone);
    const fourth = await request(app).post("/api/emergencies").send({
      bloodGroup: "AB+",
      contactPhone: phone,
      proofToken,
    });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toContain("hospital");
  });

  it("records reports anonymously, hides them from the public board, and audits them", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app);

    const missing = await request(app).post("/api/emergencies/nope/report").send({ reason: "spam" });
    expect(missing.status).toBe(404);

    const reported = await request(app)
      .post(`/api/emergencies/${sos.id}/report`)
      .send({ reason: "Looks like spam" });
    expect(reported.status).toBe(200);
    expect(reported.body.success).toBe(true);

    // Reports are moderator data — never on the public board.
    const board = await request(app).get("/api/emergencies");
    const onBoard = board.body.find((e: any) => e.id === sos.id);
    expect(onBoard.reports).toBeUndefined();

    // The report lands in the admin-only audit trail.
    const admin = await loginAs(app, "+923331234567");
    const audit = await admin.agent.get("/api/admin/audit");
    expect(audit.status).toBe(200);
    expect(audit.body.some((entry: any) => entry.action === "sos_reported" && entry.sosId === sos.id)).toBe(true);
  });
});

describe("Requester phone proof (P0-1)", () => {
  const validBody = (phone: string, proofToken?: string) => ({
    patientName: "Proof Test",
    bloodGroup: "O+",
    unitsNeeded: 1,
    contactPhone: phone,
    reason: "Proof test",
    urgency: "Immediate (SOS)",
    city: "Islamabad",
    ...(proofToken ? { proofToken } : {}),
  });

  it("rejects an anonymous SOS without a proof token (401 PROOF_REQUIRED) and creates nothing", async () => {
    const app = createApp();
    const before = (await request(app).get("/api/emergencies")).body.length;

    const res = await request(app).post("/api/emergencies").send(validBody(uniquePhone()));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PROOF_REQUIRED");
    expect(res.body.error).toContain("Verify your phone number");

    const after = (await request(app).get("/api/emergencies")).body.length;
    expect(after).toBe(before);
  });

  it("rejects a garbage proof token", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/emergencies")
      .send(validBody(uniquePhone(), "f".repeat(64)));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PROOF_REQUIRED");
  });

  it("rejects a proof token bound to a different phone", async () => {
    const app = createApp();
    const proofToken = await requestProof(app, uniquePhone());
    const res = await request(app)
      .post("/api/emergencies")
      .send(validBody(uniquePhone(), proofToken));
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("doesn't match");
  });

  it("rejects an expired proof token", async () => {
    const oldTtl = process.env.REQUESTER_PROOF_TTL_MS;
    try {
      // 1 ms TTL → any token is expired almost immediately.
      process.env.REQUESTER_PROOF_TTL_MS = "1";
      const app = createApp();
      const phone = uniquePhone();
      const proofToken = await requestProof(app, phone);
      await new Promise((r) => setTimeout(r, 20));
      const res = await request(app)
        .post("/api/emergencies")
        .send(validBody(phone, proofToken));
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("expired");
    } finally {
      if (oldTtl === undefined) delete process.env.REQUESTER_PROOF_TTL_MS;
      else process.env.REQUESTER_PROOF_TTL_MS = oldTtl;
    }
  });

  it("lets one proof token cover several posts within its lifetime (multi-use)", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const proofToken = await requestProof(app, phone);

    const first = await request(app)
      .post("/api/emergencies")
      .send({ ...validBody(phone, proofToken), bloodGroup: "O-" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/emergencies")
      .send({ ...validBody(phone, proofToken), bloodGroup: "A+" });
    expect(second.status).toBe(200);
  });

  it("never echoes the proof token on the requester OTP request path in non-test mode", async () => {
    const app = createApp();
    // devOtp is dev-only; the proof token itself is only ever issued on
    // verify — never on request.
    const res = await request(app).post("/api/requester/otp/request").send({ phone: uniquePhone() });
    expect(res.status).toBe(200);
    expect(res.body.proofToken).toBeUndefined();
  });

  it("rejects a requester verify with a wrong code and issues no proof", async () => {
    const app = createApp();
    const phone = uniquePhone();
    await request(app).post("/api/requester/otp/request").send({ phone });
    const res = await request(app)
      .post("/api/requester/otp/verify")
      .send({ phone, code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.proofToken).toBeUndefined();
  });
});

describe("Transparent donor ranking (Phase 3)", () => {
  it("returns ranked matches with reasons and masked phones", async () => {
    const app = createApp();
    const { request: sos } = await createSos(app, { bloodGroup: "O+" });

    const res = await request(app).get(`/api/emergencies/${sos.id}/matches`);
    expect(res.status).toBe(200);
    const { matches } = res.body;
    expect(matches.length).toBeGreaterThan(0);

    // Sorted by score, descending.
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
    for (const m of matches) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(m.reasons)).toBe(true);
      expect(m.reasons.length).toBeGreaterThan(0);
      expect(m.phone).toContain("••••");
      expect(m.phoneMasked).toBe(true);
    }
  });

  it("404s on matches for an unknown SOS", async () => {
    const app = createApp();
    const res = await request(app).get("/api/emergencies/nope/matches");
    expect(res.status).toBe(404);
  });
});
