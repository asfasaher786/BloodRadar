import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createSos } from "./helpers";
import { noteCodeAttempt, MAX_FAILED_CODE_ATTEMPTS } from "../services/codeGuard";

// P3a-5: failure-based throttling for the one-time requester code. The code
// is a 48-bit secret so bulk guessing is already infeasible, but /reveal
// hands out a real donor phone number and /contact-request can spam donor
// inboxes — a modest failure budget per IP closes the brute-force door
// without ever punishing the legit requester, whose frontend polls every
// 15s with the CORRECT code (correct attempts reset the budget).

describe("noteCodeAttempt unit behaviour", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ok for the first N failures and blocked on the next", () => {
    const ip = "unit-a";
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) {
      expect(noteCodeAttempt(ip, false)).toBe("ok");
    }
    expect(noteCodeAttempt(ip, false)).toBe("blocked");
  });

  it("a correct attempt resets the budget immediately", () => {
    const ip = "unit-b";
    for (let i = 0; i < 10; i++) noteCodeAttempt(ip, false);
    expect(noteCodeAttempt(ip, true)).toBe("ok");
    // A fresh full budget — the previous 10 failures are forgotten.
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) {
      expect(noteCodeAttempt(ip, false)).toBe("ok");
    }
    expect(noteCodeAttempt(ip, false)).toBe("blocked");
  });

  it("expires the budget after the 10-minute window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    const ip = "unit-c";
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) noteCodeAttempt(ip, false);
    expect(noteCodeAttempt(ip, false)).toBe("blocked");
    vi.setSystemTime(new Date("2026-11-27T10:10:01Z"));
    expect(noteCodeAttempt(ip, false)).toBe("ok");
  });

  it("keeps budgets independent per IP", () => {
    const attacker = "unit-d1";
    const bystander = "unit-d2";
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS + 1; i++) noteCodeAttempt(attacker, false);
    expect(noteCodeAttempt(bystander, false)).toBe("ok");
    expect(noteCodeAttempt(bystander, false)).toBe("ok");
  });
});

describe("requester-code endpoints honour the failure budget", () => {
  it("reveal: 16 wrong codes give 403s then a 429, and the correct code self-heals", async () => {
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    // 15 wrong guesses → plain 403s (budget not yet exhausted).
    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) {
      const res = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=wrong-code-${i}`);
      expect(res.status).toBe(403);
    }
    // 16th wrong guess → the budget trips and the endpoint throttles.
    const blocked = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=wrong-code-final`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/incorrect code attempts/i);

    // The legit requester polls with the CORRECT code every 15s — it must
    // pass straight through even immediately after a block.
    const ok = await request(app).get(`/api/emergencies/${sos.id}/reveal?code=${requesterCode}`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("waiting");
  });

  it("contact-request: wrong codes are throttled with the same budget", async () => {
    const app = createApp();
    const { request: sos, requesterCode } = await createSos(app);

    for (let i = 0; i < MAX_FAILED_CODE_ATTEMPTS; i++) {
      const res = await request(app)
        .post(`/api/emergencies/${sos.id}/contact-request`)
        .send({ requesterCode: `wrong-code-${i}` });
      expect(res.status).toBe(403);
    }
    const blocked = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode: "wrong-code-final" });
    expect(blocked.status).toBe(429);

    // Correct code passes and actually dispatches (or honestly reports
    // zero compatible donors) — proving the block never hits the owner.
    const ok = await request(app)
      .post(`/api/emergencies/${sos.id}/contact-request`)
      .send({ requesterCode });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });
});
