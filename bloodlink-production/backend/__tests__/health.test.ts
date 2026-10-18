import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";

describe("ops endpoints", () => {
  it("serves /health with db mode", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(["mongodb", "fallback"]).toContain(res.body.mode);
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const app = createApp();
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("sends security headers and hides the framework", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("allows configured dev origins but rejects strangers (CORS)", async () => {
    const app = createApp();
    const allowed = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const stranger = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example.com");
    expect(stranger.status).toBe(403);
  });
});
