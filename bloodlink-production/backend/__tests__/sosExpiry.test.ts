import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createSos } from "./helpers";

// P0-5: an SOS auto-expires after SOS_EXPIRY_HOURS (default 48h) and the
// requester can re-confirm it's still needed with their one-time code,
// getting a fresh window. Expiry is lazy (applied on read, no cron), so
// these tests shorten the TTL via env and wait out the clock.
//
// NOTE: sosTtlMs() reads the env at call time, and existing rows carry an
// absolute expiresAt — so the TTL must be set BEFORE the SOS is created.

// 0.0001 hours = 360 ms. Long enough that create→read round-trips stay
// comfortably inside the window, short enough to wait out in a test.
const FAST_TTL = "0.0001";
const EXPIRED_WAIT_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete process.env.SOS_EXPIRY_HOURS;
});

describe("SOS auto-expiry (P0-5)", () => {
  it("expires a pending SOS after the TTL and marks it on the board", async () => {
    process.env.SOS_EXPIRY_HOURS = FAST_TTL;
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);
    expect(sos.status).toBe("Pending");
    expect(sos.expiresAt).toBeTruthy();

    await sleep(EXPIRED_WAIT_MS);

    const board = await request(app).get("/api/emergencies");
    expect(board.status).toBe(200);
    const row = board.body.find((e: any) => e.id === sos.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("Expired");
    expect(row.expiredAt).toBeTruthy();
    // The requester's secret never rides the public board, even after expiry.
    expect(row.requesterCode).toBeUndefined();
    expect(requesterCode).toBeTruthy();
  });

  it("reveal answers 'expired' to the requester after the TTL", async () => {
    process.env.SOS_EXPIRY_HOURS = FAST_TTL;
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    await sleep(EXPIRED_WAIT_MS);

    const res = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
    expect(res.body.message).toContain("48 hours");
  });

  it("re-opens an expired SOS with the requester code and a fresh expiresAt", async () => {
    process.env.SOS_EXPIRY_HOURS = FAST_TTL;
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);
    await sleep(EXPIRED_WAIT_MS);

    const ext = await request(app)
      .post(`/api/emergencies/${sos.id}/extend`)
      .send({ requesterCode });
    expect(ext.status).toBe(200);
    expect(ext.body.success).toBe(true);
    expect(ext.body.request.status).toBe("Pending");
    expect(ext.body.request.expiresAt).toBeTruthy();
    expect(new Date(ext.body.request.expiresAt).getTime())
      .toBeGreaterThan(new Date(sos.expiresAt).getTime());
    // The one-time code is never echoed back, not even to its owner.
    expect(ext.body.request.requesterCode).toBeUndefined();

    // Reveal is "waiting" again — and the fresh window expires too.
    const waiting = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(waiting.body.status).toBe("waiting");

    await sleep(EXPIRED_WAIT_MS);
    const again = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(again.body.status).toBe("expired");
  });

  it("refuses to re-open with a wrong requester code (403)", async () => {
    process.env.SOS_EXPIRY_HOURS = FAST_TTL;
    const app = createApp();
    const { request: sos } = await createSos(app);
    await sleep(EXPIRED_WAIT_MS);

    const res = await request(app)
      .post(`/api/emergencies/${sos.id}/extend`)
      .send({ requesterCode: "deadbeefdead" });
    expect(res.status).toBe(403);
  });

  it("409s when extending a terminal request (Fulfilled)", async () => {
    process.env.SOS_EXPIRY_HOURS = "1"; // 1 hour — stays Pending while we close it out.
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    const done = await request(app)
      .patch(`/api/emergencies/${sos.id}/status`)
      .send({ status: "Fulfilled", requesterCode });
    expect(done.status).toBe(200);

    const ext = await request(app)
      .post(`/api/emergencies/${sos.id}/extend`)
      .send({ requesterCode });
    expect(ext.status).toBe(409);
    expect(ext.body.error).toContain("already");
  });

  it("404s on extend for an unknown SOS", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/emergencies/nope/extend")
      .send({ requesterCode: "deadbeefdead" });
    expect(res.status).toBe(404);
  });
});
