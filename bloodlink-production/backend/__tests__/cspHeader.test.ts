import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";

// P3a-3: production serves a strict Content-Security-Policy whose allow-list
// matches what the app actually loads (self + Google Fonts + ArcGIS map
// tiles). Development must NOT get the header — Vite HMR (ws: sockets,
// injected styles) would be blocked and local dev would break.

const PROD_SECRET = "csp-test-secret-0123456789abcdef0123456789abcdef";

afterEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.JWT_SECRET;
  delete process.env.FRONTEND_URL;
  delete process.env.MONGO_URI;
  vi.resetModules();
});

describe("Content-Security-Policy (P3a-3)", () => {
  it("is absent in development so Vite HMR keeps working", async () => {
    const { createApp } = await import("../app");
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("is present in production with the strict allow-list", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = PROD_SECRET;
    process.env.FRONTEND_URL = "https://bloodradar.test";
    process.env.MONGO_URI = "mongodb://127.0.0.1:59999/definitely-unreachable";
    vi.resetModules();

    const { createApp } = await import("../app");
    const res = await request(createApp()).get("/health");
    // Unreachable DB in prod = honest 503 (P0-4); the headers still apply.
    expect(res.status).toBe(503);

    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("style-src 'self' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp).toContain("img-src 'self' data: https://services.arcgisonline.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
