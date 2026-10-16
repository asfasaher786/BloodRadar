import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";

// SMS gateways disagree on field names (Twilio: From/Body, others: from/text,
// msisdn/message). The route must accept any of them — this is what lets the
// platform swap providers via env config without touching code.

describe("incoming SMS parsing", () => {
  it("accepts Twilio-style From/Body and creates an SOS", async () => {
    const app = createApp();
    const res = await request(app).post("/api/sms/incoming").send({
      From: "+923001112233",
      Body: "NEED O+ BLOOD URGENT ISLAMABAD",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("Request received");
  });

  it("accepts lowercase from/text and resolves the city", async () => {
    const app = createApp();
    // Distinct phone: the first test already has an open O+ request from
    // +923001112233, and duplicate detection would answer that instead of
    // creating a second SOS (which is the correct product behavior).
    const res = await request(app).post("/api/sms/incoming").send({
      from: "03001112234",
      text: "o+ rawalpindi",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("Request received");

    // The created SOS must carry the normalized sender and parsed city.
    const list = await request(app).get("/api/emergencies");
    const sos = list.body.find((e: any) => e.contactPhone === "+92 300 •••• 234");
    expect(sos).toBeTruthy();
    expect(sos.city).toBe("Rawalpindi");
    expect(sos.bloodGroup).toBe("O+");
  });

  it("answers honestly when no blood group can be read", async () => {
    const app = createApp();
    // No valid group in the text and no Gemini key in tests → must NOT
    // invent a group; it says so instead.
    const res = await request(app).post("/api/sms/incoming").send({
      From: "+923001112233",
      Body: "please help me urgently",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("couldn't read your blood group");
  });

  it("rejects malformed payloads and missing senders with 400", async () => {
    const app = createApp();
    const malformed = await request(app)
      .post("/api/sms/incoming")
      .send({ From: { nested: "object" } });
    expect(malformed.status).toBe(400);

    const noSender = await request(app)
      .post("/api/sms/incoming")
      .send({ Body: "O+ ISLAMABAD" });
    expect(noSender.status).toBe(400);
  });
});
