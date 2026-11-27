import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../app";
import { CONFIG } from "../config/config";
import { registerDonor, requestOtp, uniquePhone } from "./helpers";

// P2-8: refresh tokens carry a jti registered server-side. Refresh rotates
// (old token dies, new one issued), replaying a rotated token revokes the
// whole session family, logout revokes server-side, and pre-jti legacy
// tokens are rejected outright. A 30s grace window absorbs benign
// double-refresh races between two tabs.

function refreshCookieFrom(res: any): string {
  const setCookies = (res.headers["set-cookie"] || []) as string[];
  const line = setCookies.find((c: string) => c.startsWith("br_refresh="));
  if (!line) throw new Error("no br_refresh cookie in response headers");
  return line.split(";")[0].slice("br_refresh=".length);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("refresh token rotation and revocation (P2-8)", () => {
  it("rotates the refresh token on every refresh, and the new token works", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);

    const first = await agent.post("/api/auth/refresh");
    expect(first.status).toBe(200);
    const tokenB = refreshCookieFrom(first);

    const second = await agent.post("/api/auth/refresh");
    expect(second.status).toBe(200);
    const tokenC = refreshCookieFrom(second);
    expect(tokenC).not.toBe(tokenB);
    expect(tokenC.length).toBeGreaterThan(50);

    // The rotated session still serves /me.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
  });

  it("grace window: an immediate double-refresh (two tabs) does not log the user out", async () => {
    const app = createApp();
    const { agent, phone } = await registerDonor(app);

    const first = await agent.post("/api/auth/refresh");
    expect(first.status).toBe(200);
    const tokenB = refreshCookieFrom(first);

    const second = await agent.post("/api/auth/refresh");
    expect(second.status).toBe(200);

    // A stale tab replays the just-rotated token — inside the 30s grace
    // window this is treated as a race, not theft.
    const replay = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `br_refresh=${tokenB}`);
    expect(replay.status).toBe(200);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe(phone);
  });

  it("rejects a replayed token outside the grace window and revokes the whole family", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const agent = request.agent(app);
    const code = await requestOtp(app, phone);
    const verifyRes = await agent.post("/api/auth/otp/verify").send({
      phone,
      code,
      registerAsDonor: true,
      name: "Replay Donor",
      bloodGroup: "A+",
      city: "Islamabad",
      location: "F-8",
    });
    expect(verifyRes.status).toBe(200);
    const tokenA = refreshCookieFrom(verifyRes);

    // Rotate once: A is consumed, B is now the live token.
    const first = await agent.post("/api/auth/refresh");
    expect(first.status).toBe(200);
    const tokenB = refreshCookieFrom(first);

    // Move past the 30s grace window, then replay the rotated token.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);

    const replay = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `br_refresh=${tokenA}`);
    expect(replay.status).toBe(401);

    // Family revocation: even the current live token is now dead.
    const current = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `br_refresh=${tokenB}`);
    expect(current.status).toBe(401);
  });

  it("logout revokes the refresh token server-side, not just in the browser", async () => {
    const app = createApp();
    const { agent } = await registerDonor(app);
    const loginRes = await agent.post("/api/auth/refresh");
    const token = refreshCookieFrom(loginRes);

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(200);

    // A stolen copy of the cookie can no longer mint sessions.
    const replay = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `br_refresh=${token}`);
    expect(replay.status).toBe(401);
  });

  it("rejects pre-migration refresh tokens that carry no jti", async () => {
    const app = createApp();
    const phone = uniquePhone();
    const legacy = jwt.sign({ sub: phone, role: "donor", type: "refresh" }, CONFIG.JWT_SECRET, {
      expiresIn: CONFIG.REFRESH_TOKEN_TTL_SECONDS,
    });

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `br_refresh=${legacy}`);
    expect(res.status).toBe(401);
  });
});
