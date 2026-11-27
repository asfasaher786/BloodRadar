import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";

// P3b-1: the chatbot must be steerable via env (model name), guarded by a
// strict non-diagnostic / no-dosing / helpline-always system prompt at low
// temperature, and honest about runtime health — a configured key is not a
// working AI. This file mocks @google/genai so the guardrails can be
// asserted without network calls.

const genaiMock = vi.hoisted(() => ({
  generate: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: genaiMock.generate };
  },
}));

const KEY = "test-gemini-key";
const CUSTOM_MODEL = "gemini-2.5-flash-preview";

// Fresh module registry per test: CONFIG and the `ai` instance inside
// geminiService are module-level, so env changes only take effect after a
// full re-import.
async function freshApp(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { createApp } = await import("../app");
  return createApp();
}

afterEach(() => {
  genaiMock.generate.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

describe("chatbot — configurable model (P3b-1)", () => {
  it("status reports the configured model and healthy state when the key is set", async () => {
    const app = await freshApp({ GEMINI_API_KEY: KEY, GEMINI_MODEL: CUSTOM_MODEL });
    const res = await request(app).get("/api/chat/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiEnabled: true, model: CUSTOM_MODEL, degraded: false });
  });

  it("defaults the model name when GEMINI_MODEL is not set", async () => {
    const app = await freshApp({ GEMINI_API_KEY: KEY });
    const res = await request(app).get("/api/chat/status");
    expect(res.body).toEqual({ aiEnabled: true, model: "gemini-1.5-flash", degraded: false });
  });

  it("sends the configured model to the chat call", async () => {
    genaiMock.generate.mockResolvedValue({ text: "Helpful, non-diagnostic answer." });
    const app = await freshApp({ GEMINI_API_KEY: KEY, GEMINI_MODEL: CUSTOM_MODEL });
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "where can I donate B+ blood in Islamabad?", sessionId: "guardrail-sess" });
    expect(res.status).toBe(200);
    expect(res.body.reply.source).toBe("gemini");
    expect(genaiMock.generate.mock.calls[0][0].model).toBe(CUSTOM_MODEL);
  });
});

describe("chatbot — guardrails (P3b-1)", () => {
  it("sends the non-diagnostic / no-dosing / helpline-always instructions at low temperature", async () => {
    genaiMock.generate.mockResolvedValue({ text: "Please see a doctor. This is not medical advice." });
    const app = await freshApp({ GEMINI_API_KEY: KEY, GEMINI_MODEL: CUSTOM_MODEL });

    const res = await request(app)
      .post("/api/chat")
      .send({ message: "can you diagnose my fever and tell me which medicine to take?", sessionId: "guardrail-sess" });
    expect(res.status).toBe(200);
    expect(res.body.reply.source).toBe("gemini");

    const call = genaiMock.generate.mock.calls[0][0];
    expect(call.config.temperature).toBe(0.2);

    const si: string = call.config.systemInstruction;
    // Never diagnose, never prescribe/dose, always give the helpline, and
    // always disclose the answer is not medical advice.
    expect(si).toContain("Never diagnose");
    expect(si).toContain("medication");
    expect(si.toLowerCase()).toContain("1122");
    expect(si).toContain("not medical advice");
  });

  it("keeps the SMS messy-text parser at temperature 0 on the configured model", async () => {
    genaiMock.generate.mockResolvedValue({ text: '{"bloodGroup":"B+","city":"Islamabad"}' });
    await freshApp({ GEMINI_API_KEY: KEY, GEMINI_MODEL: CUSTOM_MODEL });
    const { parseEmergencyTextWithAI } = await import("../services/geminiService");

    const parsed = await parseEmergencyTextWithAI("need b positive urgent isb");
    expect(parsed).toEqual({ bloodGroup: "B+", city: "Islamabad" });
    expect(genaiMock.generate.mock.calls[0][0].model).toBe(CUSTOM_MODEL);
    expect(genaiMock.generate.mock.calls[0][0].config.temperature).toBe(0);
  });
});

describe("chatbot — honest runtime status (P3b-1)", () => {
  it("flips to degraded after a failed live call and recovers after a success", async () => {
    genaiMock.generate.mockRejectedValueOnce(new Error("simulated quota error"));
    const app = await freshApp({ GEMINI_API_KEY: KEY });

    // First call fails → reply honestly labeled fallback, status degraded.
    const fail = await request(app)
      .post("/api/chat")
      .send({ message: "hello", sessionId: "degrade-sess" });
    expect(fail.status).toBe(200);
    expect(fail.body.reply.source).toBe("fallback");

    const degraded = await request(app).get("/api/chat/status");
    expect(degraded.body).toEqual({ aiEnabled: true, model: "gemini-1.5-flash", degraded: true });

    // Next call succeeds → status recovers to healthy.
    genaiMock.generate.mockResolvedValue({ text: "All good now." });
    const ok = await request(app)
      .post("/api/chat")
      .send({ message: "hello again", sessionId: "degrade-sess" });
    expect(ok.body.reply.source).toBe("gemini");

    const recovered = await request(app).get("/api/chat/status");
    expect(recovered.body).toEqual({ aiEnabled: true, model: "gemini-1.5-flash", degraded: false });
  });

  it("reports not-degraded when the key is absent (rules-based by design)", async () => {
    const app = await freshApp();
    const res = await request(app).get("/api/chat/status");
    expect(res.body).toEqual({ aiEnabled: false, model: null, degraded: false });
  });
});
