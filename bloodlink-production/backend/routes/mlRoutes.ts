import { Router } from "express";
import { z } from "zod";
import { TextClassifier, KMeansClustering } from "../lib/mlEngine";
import { getDonors } from "../services/dbService";
import { getRealModelStatus, classifyWithRealModel } from "../lib/realUrgencyModel";
import { sanitizeText } from "../lib/sanitize";

const router = Router();

// Chatbot intent classifier: trained on a small, hand-written set of example
// phrases (not fabricated/random data) so the chatbot can route messages to
// the right response type. Honest about what it is: a lightweight intent
// router, not a general-purpose AI.
export const chatbotClassifier = new TextClassifier();
const intentDocs = [
  "hello bot", "hi there", "assalam o alaikum", "hey", "good morning", "good evening", "how are you", "bhai", "hello",
  "need O- blood group", "find donors near saddar", "looking for B+ blood group and donor contacts", "show available donors", "is there any A- donor available", "khoon chahiye", "donor ka batayein",
  "can O+ donate to AB-?", "blood compatibility table", "who can receive A- blood?", "compatibility explanation", "blood group matching list",
  "how to register as volunteer donor", "i want to donate blood", "sign up as donor", "apna naam register krna hai", "register as volunteer",
  "emergency help blood needed", "sos critical situation", "accident trauma patient bleeding", "patient dying needs transfusion", "pims emergency blood requirment",
  "upcoming blood donation camps", "camp in centaurus mall", "where is nearest camp?", "camps schedule rawalpindi",
  "hospital contact list", "pims number", "holy family address", "shifa international contact", "nearest hospital with blood stock"
];
const intentLabels = [
  "greetings", "greetings", "greetings", "greetings", "greetings", "greetings", "greetings", "greetings", "greetings",
  "find_donor", "find_donor", "find_donor", "find_donor", "find_donor", "find_donor", "find_donor",
  "blood_compatibility", "blood_compatibility", "blood_compatibility", "blood_compatibility", "blood_compatibility",
  "register_donor", "register_donor", "register_donor", "register_donor", "register_donor",
  "emergency_sos", "emergency_sos", "emergency_sos", "emergency_sos", "emergency_sos",
  "find_camp", "find_camp", "find_camp", "find_camp",
  "hospital_info", "hospital_info", "hospital_info", "hospital_info", "hospital_info"
];
chatbotClassifier.train(intentDocs, intentLabels);

const textSchema = z.object({
  text: z.string().trim().min(1, "Missing text query").max(2000, "Text is too long"),
});

router.post("/classify-chat", async (req, res, next) => {
  try {
    const parsed = textSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Missing text query" });
    }
    const prediction = chatbotClassifier.predict(sanitizeText(parsed.data.text, 2000));
    res.json(prediction);
  } catch (err) {
    next(err);
  }
});

// Real urgency model: trained fresh, every call, on whatever real emergency
// requests actually exist in the database right now. Honestly reports when
// there isn't enough real data yet, instead of faking confidence.
router.get("/real-status", async (_req, res, next) => {
  try {
    const status = await getRealModelStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post("/real-classify-urgency", async (req, res, next) => {
  try {
    const parsed = textSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Missing text to classify" });
    }
    const result = await classifyWithRealModel(sanitizeText(parsed.data.text, 2000));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Real donor clustering: genuine K-Means over actual registered donor
// locations only — no synthetic padding — to help identify where donation
// camps would reach the most real donors.
router.get("/real-donor-clustering", async (req, res, next) => {
  try {
    const kParam = parseInt(req.query.k as string) || 3;
    const donors = await getDonors();
    const k = Math.min(5, Math.max(1, Math.min(kParam, donors.length || 1)));

    if (donors.length === 0) {
      return res.json({ centroids: [], assignments: [], silhouetteScore: 0, elbowInertia: [], realDonorCount: 0 });
    }

    const donorCoords = donors.map((d: any) => ({ latitude: d.latitude, longitude: d.longitude }));
    const kmeans = new KMeansClustering(k, 30);
    const result = kmeans.fit(donorCoords);

    res.json({ ...result, realDonorCount: donors.length });
  } catch (err) {
    next(err);
  }
});

export default router;
