import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, createSos } from "./helpers";
import { createContactRequestsForSos, getEmergencyById, getInboxForDonor } from "../services/dbService";

// P2-3: repeat contact-request calls must not flood donor inboxes. One open
// row per SOS+donor; re-sends respect a minimum gap and a cap of 3 rounds.
// NOTE: notifiedDonors counts include seeded sample donors (sample data is
// visible in test mode), so the precise assertions are at the ROW level for
// the donors this test registered.
describe("contact-request idempotency (Phase 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const app = createApp();
    const donor = await registerDonor(app, { name: "Only Donor", bloodGroup: "O-", city: "Islamabad" });
    const { request: sos, requesterCode } = await createSos(app, {
      bloodGroup: "O-",
      city: "Islamabad",
    });
    const notify = (code: string) =>
      request(app).post(`/api/emergencies/${sos.id}/contact-request`).send({ requesterCode: code });
    return { app, donor, sos, requesterCode, notify };
  }

  it("repeated calls inside the gap create exactly one inbox row and do not re-notify", async () => {
    const { donor, sos, notify, requesterCode } = await setup();

    const first = await notify(requesterCode);
    expect(first.status).toBe(200);
    expect(first.body.notifiedDonors).toBeGreaterThanOrEqual(1);

    const second = await notify(requesterCode);
    expect(second.status).toBe(200);
    expect(second.body.notifiedDonors).toBe(0); // everyone is inside the gap

    const inbox = await getInboxForDonor(donor.phone);
    const rows = inbox.filter((c: any) => c.sosId === sos.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].sendCount).toBe(1);
  });

  it("concurrent duplicate calls still leave one row per donor", async () => {
    const { donor, sos, notify, requesterCode } = await setup();

    const [a, b] = await Promise.all([notify(requesterCode), notify(requesterCode)]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    // One of the two rounds did all the first-time inserts; the other was
    // blocked by the gap. No donor got a second row.
    expect(Math.min(a.body.notifiedDonors, b.body.notifiedDonors)).toBe(0);

    const inbox = await getInboxForDonor(donor.phone);
    expect(inbox.filter((c: any) => c.sosId === sos.id)).toHaveLength(1);
  });

  it("re-sends only after the minimum gap and never beyond the cap of 3", async () => {
    const { donor, sos, notify, requesterCode } = await setup();
    const first = await notify(requesterCode);
    expect(first.body.notifiedDonors).toBeGreaterThanOrEqual(1);

    // Service-level call immediately after: still inside the gap → blocked.
    const sosRecord = await getEmergencyById(sos.id);
    expect(await createContactRequestsForSos(sosRecord)).toHaveLength(0);

    // Advance past the 10-minute gap → re-send round 2 happens.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const round2 = await createContactRequestsForSos(sosRecord);
    expect(round2.length).toBeGreaterThanOrEqual(1);
    expect(round2.every((r: any) => r.sendCount === 2)).toBe(true);

    // Round 3 = cap reached (initial + 2 re-sends).
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const round3 = await createContactRequestsForSos(sosRecord);
    expect(round3.length).toBeGreaterThanOrEqual(1);
    expect(round3.every((r: any) => r.sendCount === 3)).toBe(true);

    // Round 4 is blocked by the cap even though the gap has passed.
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await createContactRequestsForSos(sosRecord)).toHaveLength(0);
    vi.useRealTimers();

    const inbox = await getInboxForDonor(donor.phone);
    const rows = inbox.filter((c: any) => c.sosId === sos.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].sendCount).toBe(3);
  });

  it("never re-opens a request the donor already declined or that was accepted", async () => {
    const app = createApp();
    const donorA = await registerDonor(app, { name: "Donor Alpha", bloodGroup: "O-", city: "Islamabad" });
    const donorB = await registerDonor(app, { name: "Donor Beta", bloodGroup: "O-", city: "Islamabad" });
    const { request: sos, requesterCode } = await createSos(app, { bloodGroup: "O-", city: "Islamabad" });

    const notify = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode });
    expect(notify.body.notifiedDonors).toBeGreaterThanOrEqual(2);

    // Donor B declines first; donor A then accepts. A's accept supersedes
    // other OPEN rows only, so B's declined row stays declined.
    const itemB = (await getInboxForDonor(donorB.phone)).find((c: any) => c.sosId === sos.id);
    const decline = await donorB.agent.post(`/api/donors/inbox/${itemB.id}/decline`);
    expect(decline.status).toBe(200);

    const itemA = (await getInboxForDonor(donorA.phone)).find((c: any) => c.sosId === sos.id);
    const accept = await donorA.agent.post(`/api/donors/inbox/${itemA.id}/accept`);
    expect(accept.status).toBe(200);

    // Fast-forward past the gap: seeded donors may legitimately be
    // re-notified, but A's accepted and B's declined rows must NOT be
    // re-opened or duplicated.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const sosRecord = await getEmergencyById(sos.id);
    await createContactRequestsForSos(sosRecord);
    vi.useRealTimers();

    const rowsA = (await getInboxForDonor(donorA.phone)).filter((c: any) => c.sosId === sos.id);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].status).toBe("accepted");
    expect(rowsA[0].sendCount).toBe(1);

    const rowsB = (await getInboxForDonor(donorB.phone)).filter((c: any) => c.sosId === sos.id);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].status).toBe("declined");
    expect(rowsB[0].sendCount).toBe(1);
  });
});
