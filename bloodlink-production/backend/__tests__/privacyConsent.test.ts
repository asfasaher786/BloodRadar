import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, createSos, uniquePhone, requestOtp } from "./helpers";
import {
  getEmergencyById,
  getDonorByPhone,
  getInboxForDonor,
  createContactRequestsForSos,
} from "../services/dbService";
import { redactPhonesFromText, PHONE_REDACTED_PLACEHOLDER } from "../lib/phoneRedaction";

// P3b-10: privacy policy consent, requester-number purge on SOS close,
// delete-my-data, and AI phone redaction. Runs against the in-memory DB
// (dev mode) — the consent requirement and purge behaviour are identical
// in production; only the test-name block is prod-gated elsewhere.

describe("P3b-10 privacy", () => {
  it("requires privacy consent for new donor registration and records it", async () => {
    const app = createApp();
    const phone = uniquePhone();

    // The OTP verifies fine; the MISSING consent is rejected afterwards.
    let code = await requestOtp(app, phone);
    let res = await request(app).post("/api/auth/otp/verify").send({
      phone,
      code,
      registerAsDonor: true,
      name: "Consent Tester",
      bloodGroup: "B+",
      city: "Islamabad",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/privacy policy/i);

    // A successful OTP verify deletes the code record, so a fresh
    // request→verify cycle on the same phone is allowed immediately.
    code = await requestOtp(app, phone);
    res = await request(app).post("/api/auth/otp/verify").send({
      phone,
      code,
      registerAsDonor: true,
      privacyConsent: true,
      name: "Consent Tester",
      bloodGroup: "B+",
      city: "Islamabad",
    });
    expect(res.status).toBe(200);

    const donor = await getDonorByPhone(phone);
    expect(donor?.consent?.version).toBe("1.0");
    expect(typeof donor?.consent?.at).toBe("string");
  });

  it("scrubs the requester's phone when an SOS is marked Fulfilled", async () => {
    const app = createApp();
    const { agent: donorAgent, phone: donorPhone } = await registerDonor(app);
    const { request: sos, requesterCode } = await createSos(app);

    const raw = await getEmergencyById(sos.id);
    expect(raw.contactPhone).not.toContain("••••"); // sanity: raw row still has the real number
    const realPhone = raw.contactPhone as string; // captured BEFORE the in-place purge

    // Matching contact requests exist and carry the requester's number.
    const created = await createContactRequestsForSos(raw);
    const mine = created.find((c) => c.donorPhone === donorPhone);
    expect(mine).toBeDefined();
    expect(mine!.requesterPhone).toBe(realPhone);

    // Requester closes it: contact details are purged at the moment of the
    // terminal transition — SOS row and every contact-request copy.
    const res = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Fulfilled", requesterCode });
    expect(res.status).toBe(200);

    const after = await getEmergencyById(sos.id);
    expect(after.status).toBe("Fulfilled");
    expect(after.phonePurged).toBe(true);
    expect(after.contactPhone).toContain("••••");
    expect(after.contactPhone).not.toBe(realPhone);

    const inbox = await getInboxForDonor(donorPhone);
    const scrubbed = inbox.find((c) => c.id === mine!.id);
    expect(scrubbed).toBeDefined();
    expect(scrubbed!.requesterPhone).toContain("••••");
    expect(scrubbed!.requesterPhone).not.toBe(realPhone);
  });

  it("purges expired requests past the 30-day grace window and blocks re-opening them", async () => {
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    // Simulate a request that expired 31 days ago (the lazy expiry sweep
    // runs on every board read).
    const raw = await getEmergencyById(sos.id);
    raw.status = "Expired";
    raw.expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const list = await request(app).get("/api/emergencies");
    expect(list.status).toBe(200);

    const after = await getEmergencyById(sos.id);
    expect(after.phonePurged).toBe(true);
    expect(after.contactPhone).toContain("••••");

    // The requesterCode still proves ownership, but there is nothing left
    // to hand donors — re-open must fail with the honest answer.
    const extend = await request(app)
      .post(`/api/emergencies/${sos.id}/extend`)
      .send({ requesterCode });
    expect(extend.status).toBe(409);
    expect(extend.body.error).toMatch(/contact details were removed/i);
  });

  it("refuses delete-my-data while a contact request is in flight, then deletes everything", async () => {
    const app = createApp();
    const { agent, phone } = await registerDonor(app);
    const { request: sos } = await createSos(app);
    const raw = await getEmergencyById(sos.id);
    const created = await createContactRequestsForSos(raw);
    const mine = created.find((c) => c.donorPhone === phone);
    expect(mine).toBeDefined();

    // Open contact request → deletion blocked (409), donor still exists.
    let del = await agent.delete("/api/auth/me");
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/in progress/i);
    expect(await getDonorByPhone(phone)).not.toBeNull();

    // Decline it, then deletion succeeds: donor record, inbox rows and the
    // session are all gone.
    const declined = await agent.post(`/api/donors/inbox/${mine!.id}/decline`);
    expect(declined.status).toBe(200);

    del = await agent.delete("/api/auth/me");
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(await getDonorByPhone(phone)).toBeNull();
    expect((await getInboxForDonor(phone)).length).toBe(0);

    // The old session is dead on every device.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});

describe("phone redaction before AI (P3b-10)", () => {
  it("strips phone-like sequences and leaves harmless text alone", () => {
    expect(redactPhonesFromText("call me on 0300 1234567 please")).toBe(
      `call me on ${PHONE_REDACTED_PLACEHOLDER} please`
    );
    expect(redactPhonesFromText("my number is +92 300 5551234")).toContain(PHONE_REDACTED_PLACEHOLDER);
    expect(redactPhonesFromText("whatsapp 923001234567")).toContain(PHONE_REDACTED_PLACEHOLDER);
    expect(redactPhonesFromText("(051) 123-4567")).toContain(PHONE_REDACTED_PLACEHOLDER);

    // Not phones: short helpline, blood groups, small counts.
    expect(redactPhonesFromText("dial 1122 now")).toBe("dial 1122 now");
    expect(redactPhonesFromText("I need O+ blood, 3 units")).toBe("I need O+ blood, 3 units");
    expect(redactPhonesFromText("")).toBe("");
  });
});
