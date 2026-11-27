import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { chatbotClassifier } from "./mlRoutes";
import { askGemini, chatAiStatus } from "../services/geminiService";
import { getChatSessionHistory, addChatMessage } from "../services/dbService";
import { sanitizeText } from "../lib/sanitize";

const router = Router();

// B2 fix: a chat message only triggers an emergency alert when the
// classifier is genuinely confident. The old keyword-matching fallback fired
// full emergency framing on unrelated chat (e.g. "bleeding" in a movie
// question) at ~17% confidence. Threshold decided in the Phase 0 audit.
const EMERGENCY_CONFIDENCE_THRESHOLD = 0.6;

// Honest AI labeling (Phase 3): the assistant must never claim capabilities
// it doesn't have. When GEMINI_API_KEY is unset every answer comes from the
// local rules-based fallback, and both the UI and the reply itself say so.
// P3b-1 adds the real model name and a runtime "degraded" flag: configured
// is not working, and the UI must know when live calls are falling back.
router.get("/status", (_req, res) => {
  res.json(chatAiStatus());
});

const chatSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(1000, "Message is too long"),
  sessionId: z.string().trim().max(100).optional(),
  language: z.enum(["en", "ur"]).optional(),
});

// P2-5: chat sessions are private per visitor. Session ids must look like
// server-generated ids; anything else (including the legacy shared
// "default-session" / "bloodradar_session_user" buckets) is replaced with a
// fresh crypto-random UUID so no visitor ever shares another visitor's
// history.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const LEGACY_SHARED_SESSION_IDS = new Set(["default-session", "bloodradar_session_user"]);

router.post("/", async (req, res, next) => {
  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Missing message payload" });
    }

    const message = sanitizeText(parsed.data.message, 1000);
    const clientSid = parsed.data.sessionId ? sanitizeText(parsed.data.sessionId, 100) : "";
    const sid =
      clientSid && SESSION_ID_RE.test(clientSid) && !LEGACY_SHARED_SESSION_IDS.has(clientSid)
        ? clientSid
        : crypto.randomUUID();
    const languageEnum: "en" | "ur" = parsed.data.language === "ur" ? "ur" : "en";

    // 1. Fetch Session History
    const history = await getChatSessionHistory(sid);

    // Save user message
    const userMsg = {
      id: "msg-" + crypto.randomUUID() + "-user",
      sender: "user" as const,
      text: message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    await addChatMessage(sid, userMsg);

    // 2. Classify intent using native ML Text Classifier — confidence-gated.
    const chatClassifierResult = chatbotClassifier.predict(message);
    const isEmergencyAlert =
      chatClassifierResult.label === "emergency_sos" &&
      chatClassifierResult.confidence >= EMERGENCY_CONFIDENCE_THRESHOLD;

    // 3. Obtain AI response (from Gemini API with metadata or local clinical fallbacks)
    const { text: replyText, source } = await askGemini(
      message,
      history,
      languageEnum,
      isEmergencyAlert,
      chatClassifierResult.label,
      chatClassifierResult.confidence
    );

    const aiMsg = {
      id: "msg-" + crypto.randomUUID() + "-ai",
      sender: "ai" as const,
      text: replyText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isEmergencyAlert,
      source
    };

    await addChatMessage(sid, aiMsg);
    const updatedHistory = await getChatSessionHistory(sid);

    res.json({
      reply: aiMsg,
      history: updatedHistory,
      sessionId: sid
    });
  } catch (err) {
    next(err);
  }
});

export default router;
