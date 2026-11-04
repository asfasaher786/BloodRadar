import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

// P0-4: production must fail fast at boot without MONGO_URI (never silently
// serve from the in-memory store), and /health must report 503 when the DB
// is not really mongodb. The vitest runner (VITEST=true) is exempt from the
// boot gate so prod-mode behaviour can be exercised here; this file also
// proves the gate itself by unsetting VITEST and expecting the refusal.

const PROD_SECRET = "boot-test-secret-0123456789abcdef0123456789abcdef";

afterAll(() => {
  process.env.NODE_ENV = "test";
  process.env.VITEST = "true";
  delete process.env.JWT_SECRET;
  delete process.env.FRONTEND_URL;
  delete process.env.MONGO_URI;
  vi.resetModules();
});

describe("production boot fail-fast (P0-4)", () => {
  it("vitest runner sets VITEST so prod-mode tests can boot", () => {
    expect(process.env.VITEST).toBe("true");
  });

  it("refuses to boot in production without MONGO_URI", async () => {
    delete process.env.VITEST; // simulate a real deployment
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = PROD_SECRET;
    process.env.FRONTEND_URL = "https://bloodradar.test";
    delete process.env.MONGO_URI;
    vi.resetModules();

    await expect(import("../config/config")).rejects.toThrow(/MONGO_URI is required in production/);

    process.env.VITEST = "true";
  });

  it("boots in production when MONGO_URI is present", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = PROD_SECRET;
    process.env.FRONTEND_URL = "https://bloodradar.test";
    process.env.MONGO_URI = "mongodb://127.0.0.1:59999/definitely-unreachable";
    vi.resetModules();

    const { CONFIG } = await import("../config/config");
    expect(CONFIG.IS_PROD).toBe(true);

    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).get("/health");
    // Unreachable DB → fallback mode → production health is 503, honest.
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
    expect(res.body.mode).toBe("fallback");
  });

  it("dev health stays 200 on the fallback store (unchanged)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.MONGO_URI;
    vi.resetModules();

    const { createApp } = await import("../app");
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.mode).toBe("fallback");
  });
});
