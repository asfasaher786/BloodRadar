import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

// Webhook authentication for the SMS gateway. When SMS_WEBHOOK_SECRET is
// configured, unauthenticated calls must be rejected — otherwise anyone
// could raise SOS on behalf of arbitrary phone numbers. Tested in a fresh
// module graph so CONFIG picks up the stubbed env var.

describe("SMS webhook secret", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Generous timeout: vi.resetModules() forces a cold re-import of the whole
  // app graph on first run, which takes several seconds before Vitest warms
  // its transform cache.
  it("rejects calls without the secret and accepts the gateway's header", async () => {
    vi.stubEnv("SMS_WEBHOOK_SECRET", "gateway-shared-secret");
    vi.resetModules();
    const { createApp } = await import("../app");
    const app = createApp();

    const payload = { From: "+923001112233", Body: "O+ RAWALPINDI" };

    const noSecret = await request(app).post("/api/sms/incoming").send(payload);
    expect(noSecret.status).toBe(401);

    const wrongSecret = await request(app)
      .post("/api/sms/incoming")
      .set("x-webhook-secret", "not-the-secret")
      .send(payload);
    expect(wrongSecret.status).toBe(401);

    const withHeader = await request(app)
      .post("/api/sms/incoming")
      .set("x-webhook-secret", "gateway-shared-secret")
      .send(payload);
    expect(withHeader.status).toBe(200);
    expect(withHeader.body.reply).toContain("Request received");

    const withBearer = await request(app)
      .post("/api/sms/incoming")
      .set("Authorization", "Bearer gateway-shared-secret")
      .send(payload);
    expect(withBearer.status).toBe(200);
  }, 30000);
});
