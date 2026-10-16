import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";

// Phase 3 AI honesty: the chatbot must never claim AI it doesn't have.
// With no GEMINI_API_KEY configured (as in tests), every reply comes from
// the local rules-based fallback and must be labeled "fallback", and the
// status endpoint must say the AI is disabled.

describe("chat triage — honest AI labeling", () => {
  const app = createApp();

  it("status endpoint reports AI disabled when no Gemini key is set", async () => {
    const res = await request(app).get("/api/chat/status");
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(false);
    expect(res.body.model).toBeNull();
  });

  it("labels replies with their real source (fallback in tests)", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "hello", sessionId: "test-session-source" });
    expect(res.status).toBe(200);
    expect(res.body.reply.sender).toBe("ai");
    expect(res.body.reply.source).toBe("fallback");
    expect(res.body.reply.text.length).toBeGreaterThan(0);
    // Both the user message and the reply land in the session history.
    expect(res.body.history.length).toBeGreaterThanOrEqual(2);
    expect(res.body.history[0].sender).toBe("user");
  });

  it("rejects empty messages with 400", async () => {
    const res = await request(app).post("/api/chat").send({ message: "   " });
    expect(res.status).toBe(400);
  });

  it("flags a confident emergency phrase with triage framing", async () => {
    // Exact training-doc phrasing for the intent classifier, so this must
    // clear the 0.6 confidence gate — the B2 fix from the Phase 0 audit.
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "emergency help blood needed", sessionId: "test-session-sos" });
    expect(res.status).toBe(200);
    expect(res.body.reply.isEmergencyAlert).toBe(true);
    expect(res.body.reply.source).toBe("fallback");
    expect(res.body.reply.text).toContain("EMERGENCY ASSISTANCE TRIAGE");
  });

  it("keeps non-emergency chat calm (no emergency framing)", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "explain blood compatibility for A-", sessionId: "test-session-compat" });
    expect(res.status).toBe(200);
    expect(res.body.reply.isEmergencyAlert).toBeFalsy();
    expect(res.body.reply.text).toContain("Compatibility");
  });
});
