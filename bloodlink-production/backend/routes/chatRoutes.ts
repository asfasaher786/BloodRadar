import { Router } from "express";
import { chatbotClassifier } from "./mlRoutes";
import { askGemini } from "../services/geminiService";
import { getChatSessionHistory, addChatMessage } from "../services/dbService";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { message, sessionId, language = "en" } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Missing message payload" });
    }

    const sid = sessionId || "default-session";
    const languageEnum: "en" | "ur" = language === "ur" ? "ur" : "en";

    // 1. Fetch Session History
    const history = await getChatSessionHistory(sid);
    
    // Save user message
    const userMsg = {
      id: "msg-" + Date.now() + "-user",
      sender: "user" as const,
      text: message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    await addChatMessage(sid, userMsg);

    // 2. Classify intent using native ML Text Classifier
    const chatClassifierResult = chatbotClassifier.predict(message);
    let isEmergencyAlert = chatClassifierResult.label === "emergency_sos";

    // Fallback emergency heuristics
    const lowercase = message.toLowerCase();
    if (!isEmergencyAlert && (
      lowercase.includes("emergency") ||
      lowercase.includes("sos") ||
      lowercase.includes("accident") ||
      lowercase.includes("dying") ||
      lowercase.includes("bleeding") ||
      lowercase.includes("urgent blood") ||
      lowercase.includes("bhai match") ||
      lowercase.includes("saans") ||
      lowercase.includes("khoon")
    )) {
      isEmergencyAlert = true;
    }

    // 3. Obtain AI response (from Gemini API with metadata or local clinical fallbacks)
    const replyText = await askGemini(
      message,
      history,
      languageEnum,
      isEmergencyAlert,
      chatClassifierResult.label,
      chatClassifierResult.confidence
    );

    const aiMsg = {
      id: "msg-" + Date.now() + "-ai",
      sender: "ai" as const,
      text: replyText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isEmergencyAlert
    };
    
    await addChatMessage(sid, aiMsg);
    const updatedHistory = await getChatSessionHistory(sid);

    res.json({
      reply: aiMsg,
      history: updatedHistory
    });

  } catch (err: any) {
    res.status(500).json({ error: "Failed to process chat: " + err.message });
  }
});

export default router;
