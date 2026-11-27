import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, createSos } from "./helpers";

// Phase 2 atomicity: logDonation and acceptContactRequest used to read then
// write, so concurrent calls could double-count donations or let two donors
// both accept. These tests fire both operations simultaneously and assert
// exactly one wins. (In-memory fallback DB; the check-and-write blocks are
// await-free so they are atomic within the event loop. The Mongo path uses
// conditional findOneAndUpdate filters, which is exercised against Atlas at
// gate time.)
describe("concurrent writes (Phase 2 atomicity)", () => {
  it("only one of two simultaneous accepts wins — the loser gets an honest 400", async () => {
    const app = createApp();
    const donorA = await registerDonor(app, { name: "Donor Alpha", bloodGroup: "O-", city: "Islamabad" });
    const donorB = await registerDonor(app, { name: "Donor Beta", bloodGroup: "O-", city: "Islamabad" });

    const { request: sos, requesterCode } = await createSos(app, {
      bloodGroup: "O-",
      city: "Islamabad",
    });
    const notify = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode });
    expect(notify.status).toBe(200);

    const itemA = (await donorA.agent.get("/api/donors/inbox")).body.find((i: any) => i.sosId === sos.id);
    const itemB = (await donorB.agent.get("/api/donors/inbox")).body.find((i: any) => i.sosId === sos.id);
    expect(itemA.status).toBe("open");
    expect(itemB.status).toBe("open");

    const [resA, resB] = await Promise.all([
      donorA.agent.post(`/api/donors/inbox/${itemA.id}/accept`),
      donorB.agent.post(`/api/donors/inbox/${itemB.id}/accept`),
    ]);

    // Exactly one accept succeeds; the other is rejected (the request is
    // already accepted or superseded — never two winners).
    expect([resA.status, resB.status].sort()).toEqual([200, 400]);

    const afterA = (await donorA.agent.get("/api/donors/inbox")).body.find((i: any) => i.sosId === sos.id);
    const afterB = (await donorB.agent.get("/api/donors/inbox")).body.find((i: any) => i.sosId === sos.id);
    const finalStatuses = [afterA.status, afterB.status].sort();
    expect(finalStatuses).toEqual(["accepted", "superseded"]);
  });

  it("two simultaneous log-donations count once, not twice", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);

    const [r1, r2] = await Promise.all([
      agent.post("/api/donors/log-donation"),
      agent.post("/api/donors/log-donation"),
    ]);

    // One succeeds; the other hits the 90-day recovery gap (fresh
    // lastDonationDate set by the winner).
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.donor.stats.donationsCount).toBe(1);
    expect(me.body.user.donor.stats.livesSaved).toBe(3);
  });
});
