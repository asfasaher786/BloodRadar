import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { registerDonor, loginAs, createSos, uniquePhone } from "./helpers";
import { isWithinQuietHours, validateNotifyPrefs, DEFAULT_NOTIFY_PREFS, NotifyPrefs } from "../lib/notifyService";

// Donor alerting (Phase 3.5): preferences + quiet hours + targeted
// notifications + push subscription lifecycle. Deterministic: quiet-hour
// logic is tested as a pure function, and integration tests pin quiet
// windows that either always or never match the current time.

function prefs(overrides: Partial<NotifyPrefs> = {}): NotifyPrefs {
  return { ...DEFAULT_NOTIFY_PREFS, ...overrides };
}

async function pollMine(agent: any, expectCount: number, attempts = 25): Promise<any[]> {
  // The SOS route fires donor alerts without blocking the response, so the
  // notification lands a tick later. Poll the donor's own feed briefly.
  for (let i = 0; i < attempts; i++) {
    const res = await agent.get("/api/notifications/mine");
    if (res.status === 200 && (res.body as any[]).length >= expectCount) return res.body;
    await new Promise(r => setTimeout(r, 20));
  }
  const res = await agent.get("/api/notifications/mine");
  return res.body;
}

describe("quiet-hours pure logic", () => {
  it("is off when quietHoursEnabled is false", () => {
    expect(isWithinQuietHours(prefs({ quietHoursEnabled: false }), 23, 30)).toBe(false);
  });

  it("handles an overnight window (22:00-08:00)", () => {
    const p = prefs({ quietStart: "22:00", quietEnd: "08:00" });
    expect(isWithinQuietHours(p, 12, 0)).toBe(false);
    expect(isWithinQuietHours(p, 23, 0)).toBe(true);
    expect(isWithinQuietHours(p, 3, 30)).toBe(true);
    expect(isWithinQuietHours(p, 8, 0)).toBe(false); // end is exclusive
    expect(isWithinQuietHours(p, 22, 0)).toBe(true); // start is inclusive
  });

  it("handles a same-day window (09:00-17:00)", () => {
    const p = prefs({ quietStart: "09:00", quietEnd: "17:00" });
    expect(isWithinQuietHours(p, 10, 0)).toBe(true);
    expect(isWithinQuietHours(p, 18, 0)).toBe(false);
  });

  it("treats a zero-length window as off", () => {
    expect(isWithinQuietHours(prefs({ quietStart: "12:00", quietEnd: "12:00" }), 12, 0)).toBe(false);
  });

  it("validates preference shapes", () => {
    expect(validateNotifyPrefs(null)).toBeNull();
    expect(validateNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, quietStart: "25:00" })).toBeNull();
    expect(validateNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, smsAlerts: "yes" })).toBeNull();
    expect(validateNotifyPrefs(DEFAULT_NOTIFY_PREFS)).toEqual(DEFAULT_NOTIFY_PREFS);
  });
});

describe("notification preferences API", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = createApp(); });

  it("requires login for preferences", async () => {
    const anon = await request(app).get("/api/notifications/preferences");
    expect(anon.status).toBe(401);
    const anonPut = await request(app).put("/api/notifications/preferences").send(DEFAULT_NOTIFY_PREFS);
    expect(anonPut.status).toBe(401);
  });

  it("returns safe defaults for a donor who never set any", async () => {
    const { agent } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    const res = await agent.get("/api/notifications/preferences");
    expect(res.status).toBe(200);
    expect(res.body.prefs).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(res.body.timezone).toBeTruthy();
  });

  it("saves and returns prefs, rejecting invalid payloads", async () => {
    const { agent } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    const bad = await agent.put("/api/notifications/preferences").send({ ...DEFAULT_NOTIFY_PREFS, quietStart: "not-a-time" });
    expect(bad.status).toBe(400);

    const zeroWindow = await agent.put("/api/notifications/preferences").send({ ...DEFAULT_NOTIFY_PREFS, quietStart: "10:00", quietEnd: "10:00" });
    expect(zeroWindow.status).toBe(400);

    const good = await agent.put("/api/notifications/preferences").send(
      prefs({ smsAlerts: true, quietHoursEnabled: false, quietStart: "23:00", quietEnd: "07:00" })
    );
    expect(good.status).toBe(200);

    const got = await agent.get("/api/notifications/preferences");
    expect(got.body.prefs.smsAlerts).toBe(true);
    expect(got.body.prefs.quietHoursEnabled).toBe(false);
  });
});

describe("matched-SOS donor alerting", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = createApp(); });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("alerts an eligible donor in-app, masking the requester phone", async () => {
    const { agent, phone } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    // Quiet hours off so delivery is deterministic regardless of wall clock.
    await agent.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false }));

    const rawRequesterPhone = "+923001112233";
    const sos = await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: rawRequesterPhone });

    const mine = await pollMine(agent, 1);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const alert = mine.find((n: any) => n.sosId === sos.request.id);
    expect(alert).toBeTruthy();
    expect(alert.targetPhone).toBe(phone);
    // Privacy: the requester's full number never appears in the alert text.
    expect(alert.message).not.toContain(rawRequesterPhone);
    expect(alert.message).toContain("••••");
  });

  it("does not alert donors of an incompatible blood group or different city", async () => {
    const { agent } = await registerDonor(app, { bloodGroup: "O+", city: "Islamabad" });
    await agent.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false }));

    // AB- in Rawalpindi: this O+ Islamabad donor is neither compatible nor local.
    await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: uniquePhone() });

    await new Promise(r => setTimeout(r, 120));
    const res = await agent.get("/api/notifications/mine");
    expect(res.body).toHaveLength(0);
  });

  it("suppresses everything during quiet hours unless Immediate SOS is allowed through", async () => {
    const { agent } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    // A quiet window that covers the whole day = always quiet (deterministic).
    await agent.put("/api/notifications/preferences").send(
      prefs({ quietStart: "00:00", quietEnd: "23:59", allowImmediateDuringQuiet: false })
    );

    const urgent = await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: uniquePhone() });
    await new Promise(r => setTimeout(r, 150));
    let res = await agent.get("/api/notifications/mine");
    expect(res.body.filter((n: any) => n.sosId === urgent.request.id)).toHaveLength(0);

    // The donor opts into the life-critical bypass: Immediate SOS gets through.
    await agent.put("/api/notifications/preferences").send(
      prefs({ quietStart: "00:00", quietEnd: "23:59", allowImmediateDuringQuiet: true })
    );
    const immediate = await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: uniquePhone() });
    const mine = await pollMine(agent, 1);
    expect(mine.some((n: any) => n.sosId === immediate.request.id)).toBe(true);
  });

  it("sends SMS through the configured provider when the donor opted in", async () => {
    const smsSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { agent } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    await agent.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false, smsAlerts: true }));

    await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: uniquePhone() });

    // The dev provider prints [SMS:console] — assert it was actually dispatched.
    await new Promise(r => setTimeout(r, 200));
    const smsLines = smsSpy.mock.calls.map(c => String(c[0])).filter(l => l.startsWith("[SMS:console]"));
    expect(smsLines.length).toBeGreaterThanOrEqual(1);
    expect(smsLines.join(" ")).toContain("AB-");
  });

  it("keeps targeted alerts out of the public feed and read-all scoped to the owner", async () => {
    const { agent: donorA } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    const { agent: donorB } = await registerDonor(app, { bloodGroup: "O+", city: "Islamabad" });
    await donorA.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false }));
    await donorB.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false }));

    // A Rawalpindi SOS alerts only donorA (donorB is O+ Islamabad).
    await createSos(app, { bloodGroup: "AB-", city: "Rawalpindi", contactPhone: uniquePhone() });
    await pollMine(donorA, 1);

    // Public feed: no donor-targeted rows (targetPhone must never leak).
    const pub = await request(app).get("/api/notifications");
    expect(pub.body.every((n: any) => !n.targetPhone)).toBe(true);

    // Mark-read scoped: A's alert read; B's feed unaffected (and empty).
    await donorA.post("/api/notifications/mine/read-all");
    const aMine = await donorA.get("/api/notifications/mine");
    expect(aMine.body.every((n: any) => n.read)).toBe(true);
    const bMine = await donorB.get("/api/notifications/mine");
    expect(bMine.body).toHaveLength(0);
  });
});

describe("web push subscription lifecycle", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = createApp(); });

  const validSub = {
    endpoint: "https://push.example.com/sub/abc123",
    keys: { p256dh: "BN9qGpQmDummyKeyMaterialPaddingPadding", auth: "auth-secret-1234567890" },
  };

  it("reports push honestly as disabled when no VAPID keys are configured", async () => {
    const res = await request(app).get("/api/notifications/push/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.publicKey).toBeNull();
  });

  it("requires login and valid payloads to subscribe", async () => {
    const anon = await request(app).post("/api/notifications/push/subscribe").send(validSub);
    expect(anon.status).toBe(401);

    const { agent } = await registerDonor(app, { bloodGroup: "AB-", city: "Rawalpindi" });
    const bad = await agent.post("/api/notifications/push/subscribe").send({ endpoint: "not-a-url" });
    expect(bad.status).toBe(400);

    const ok = await agent.post("/api/notifications/push/subscribe").send(validSub);
    expect(ok.status).toBe(200);

    // Unsubscribing clears the stored subscription.
    const off = await agent.post("/api/notifications/push/unsubscribe");
    expect(off.status).toBe(200);
    const offAnon = await request(app).post("/api/notifications/push/unsubscribe");
    expect(offAnon.status).toBe(401);
  });

  it("requires a donor profile to save preferences", async () => {
    const phone = uniquePhone();
    const { agent } = await loginAs(app, phone); // login without registering
    const res = await agent.put("/api/notifications/preferences").send(prefs({ quietHoursEnabled: false }));
    expect(res.status).toBe(404);
  });
});
