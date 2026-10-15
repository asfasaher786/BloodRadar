import { Router } from "express";
import { z } from "zod";
import { getCamps, incrementCampRegistration } from "../services/dbService";
import { sanitizeText } from "../lib/sanitize";

const router = Router();

const cityQuerySchema = z.object({
  city: z.string().trim().max(50).optional(),
});

const registerSchema = z.object({
  campId: z.string().trim().min(1, "Camp id is required").max(80),
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = cityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters" });
    }
    const { city } = parsed.data;
    let list = await getCamps();

    if (city) {
      list = list.filter(c => c.city.toLowerCase() === city.toLowerCase());
    }

    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Missing campaign specification" });
    }

    const updatedCamp = await incrementCampRegistration(sanitizeText(parsed.data.campId, 80));
    if (updatedCamp) {
      return res.json({ success: true, camp: updatedCamp });
    }
    res.status(404).json({ error: "Selected campaign not found" });
  } catch (err) {
    next(err);
  }
});

export default router;
