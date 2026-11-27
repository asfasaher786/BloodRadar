import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { loginAs, createSos, uniquePhone } from "./helpers";
import { detectSuspiciousFlags } from "../lib/sosFlags";

// P3a-6: fake-SOS defences. Three layers, all honest about their limits:
// 1. keyword flagging is SOFT — suspicious content still posts (a heuristic
//    must never suppress a real emergency) but lands in the admin queue;
// 2. the admin queue shows reports AND system flags, with a one-tap block;
// 3. a blocked phone can never post again (reversible by an admin).
// The per-phone 3/day cap and duplicate detection were built in Phase 3 and
// are covered by existing tests.

const ADMIN_PHONE = "+923331234567";

describe("detectSuspiciousFlags (unit)", () => {
  it("flags test keywords, keyboard mash, repeated chars and numbers-only names", () => {
    expect(detectSuspiciousFlags({ patientName: "Test Patient" })).toContain("test-like keyword in patient name");
    expect(detectSuspiciousFlags({ reason: "demo request for blood" })).toContain("test-like keyword in reason");
    expect(detectSuspiciousFlags({ patientName: "asdfasdf" })).toContain("keyboard mash in patient name");
    expect(detectSuspiciousFlags({ reason: "help please aaaaa" })).toContain("repeated characters in reason");
    expect(detectSuspiciousFlags({ patientName: "123456789" })).toContain("numbers-only patient name");
  });

  it("leaves legitimate urgent content alone", () => {
    expect(detectSuspiciousFlags({
      patientName: "Muhammad Ali Khan",
      reason: "Accident victim needs B+ urgently, bleeding in ICU",
      urgency: "Immediate (SOS)",
      city: "Islamabad",
      neighbourhood: "G-10/4",
    })).toEqual([]);
  });

  it("does not false-flag words containing test/demo as substrings", () => {
    expect(detectSuspiciousFlags({ patientName: "Amber Testoni" })).toEqual([]);
    expect(detectSuspiciousFlags({ reason: "The latest report says urgent" })).toEqual([]);
    expect(detectSuspiciousFlags({ patientName: "Protestant" })).toEqual([]);
  });
});

describe("soft flagging surfaces in the admin queue only", () => {
  it("a fake-looking SOS posts publicly but appears in the queue with its flags", async () => {
    const app = createApp();
    const contactPhone = uniquePhone();
    const { request: sos } = await createSos(app, {
      contactPhone,
      bloodGroup: "A+",
    });

    // Public board: the SOS is there, but moderation data never leaves.
    const board = await request(app).get("/api/emergencies");
    const onBoard = board.body.find((e: any) => e.id === sos.id);
    expect(onBoard).toBeTruthy();
    expect(onBoard.flaggedBySystem).toBeUndefined();
    expect(onBoard.reports).toBeUndefined();

    // Admin queue: the auto-flags are visible with the reasons.
    const { agent: admin } = await loginAs(app, ADMIN_PHONE);
    const queue = await admin.get("/api/admin/reported");
    const entry = queue.body.find((e: any) => e.id === sos.id);
    expect(entry).toBeTruthy();
    expect(entry.flaggedBySystem.reasons.length).toBeGreaterThan(0);
    expect(entry.requesterCode).toBeUndefined();

    // Dismiss clears BOTH reports and system flags — it leaves the queue.
    const dismissed = await admin.post(`/api/admin/reported/${sos.id}/dismiss`);
    expect(dismissed.status).toBe(200);
    const after = await admin.get("/api/admin/reported");
    expect(after.body.some((e: any) => e.id === sos.id)).toBe(false);
  });

  it("legitimate content never lands in the queue on its own", async () => {
    const app = createApp();
    // Careful: the shared helper uses test-looking defaults, so post a
    // realistic SOS through the raw endpoint instead.
    const contactPhone = uniquePhone();
    const proof = await request(app).post("/api/requester/otp/request").send({ phone: contactPhone });
    const code = proof.body.devOtp;
    const ver = await request(app).post("/api/requester/otp/verify").send({ phone: contactPhone, code });
    const created = await request(app)
      .post("/api/emergencies")
      .send({
        patientName: "Abdul Rehman",
        bloodGroup: "B+",
        unitsNeeded: 2,
        contactPhone,
        reason: "Road accident, surgery in progress",
        urgency: "Immediate (SOS)",
        city: "Rawalpindi",
        proofToken: ver.body.proofToken,
      });
    expect(created.status).toBe(200);
    const sos = created.body.request;
    expect(sos.flaggedBySystem).toBeUndefined();

    const { agent: admin } = await loginAs(app, ADMIN_PHONE);
    const queue = await admin.get("/api/admin/reported");
    expect(queue.body.some((e: any) => e.id === sos.id)).toBe(false);
  });
});

describe("one-tap block (P3a-6)", () => {
  it("blocks the phone, purges its SOSes, stops new posts, and unblocks", async () => {
    const app = createApp();
    const contactPhone = uniquePhone();
    const { request: sos } = await createSos(app, { contactPhone, bloodGroup: "O+" });

    // Non-admins cannot block (unauthenticated → 401; the role gate is
    // covered by the adminDashboard suite, so no extra OTP budget here).
    const denied = await request(app).post(`/api/admin/reported/${sos.id}/block`);
    expect(denied.status).toBe(401);

    const { agent: admin } = await loginAs(app, ADMIN_PHONE);

    // One tap: block the phone.
    const blocked = await admin.post(`/api/admin/reported/${sos.id}/block`);
    expect(blocked.status).toBe(200);
    expect(blocked.body.success).toBe(true);
    expect(blocked.body.removedSosCount).toBeGreaterThanOrEqual(1);

    // The SOS is gone from the public board.
    const board = await request(app).get("/api/emergencies");
    expect(board.body.some((e: any) => e.id === sos.id)).toBe(false);

    // The number appears on the blocked list.
    const list = await admin.get("/api/admin/blocked");
    expect(list.body.some((b: any) => b.phone === contactPhone)).toBe(true);

    // The blocked phone cannot raise a new SOS — 403, not a friendly dup.
    const proof = await request(app).post("/api/requester/otp/request").send({ phone: contactPhone });
    const code = proof.body.devOtp;
    const ver = await request(app).post("/api/requester/otp/verify").send({ phone: contactPhone, code });
    const attempt = await request(app)
      .post("/api/emergencies")
      .send({
        patientName: "Fake Again",
        bloodGroup: "AB+",
        unitsNeeded: 1,
        contactPhone,
        reason: "another one",
        city: "Islamabad",
        proofToken: ver.body.proofToken,
      });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toMatch(/blocked/i);

    // Unblock restores posting rights (removed requests stay removed).
    const unblocked = await admin.post(`/api/admin/blocked/${encodeURIComponent(contactPhone)}/unblock`);
    expect(unblocked.status).toBe(200);

    const proof2 = await request(app).post("/api/requester/otp/request").send({ phone: contactPhone });
    const code2 = proof2.body.devOtp;
    const ver2 = await request(app).post("/api/requester/otp/verify").send({ phone: contactPhone, code: code2 });
    const again = await request(app)
      .post("/api/emergencies")
      .send({
        patientName: "Real Person Now",
        bloodGroup: "O-",
        unitsNeeded: 1,
        contactPhone,
        reason: "Genuine need after mistaken block",
        city: "Islamabad",
        proofToken: ver2.body.proofToken,
      });
    expect(again.status).toBe(200);

    const audit = await admin.get("/api/admin/audit");
    expect(audit.body.some((e: any) => e.action === "phone_blocked")).toBe(true);
    expect(audit.body.some((e: any) => e.action === "phone_unblocked")).toBe(true);
  });
});
