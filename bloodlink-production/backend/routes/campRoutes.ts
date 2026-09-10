import { Router } from "express";
import { getCamps, incrementCampRegistration } from "../services/dbService";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { city } = req.query;
    let list = await getCamps();

    if (city) {
      list = list.filter(c => c.city.toLowerCase() === (city as string).toLowerCase());
    }

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load blood camps: " + err.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { campId } = req.body;
    if (!campId) {
      return res.status(400).json({ error: "Missing campaign specification" });
    }

    const updatedCamp = await incrementCampRegistration(campId);
    if (updatedCamp) {
      return res.json({ success: true, camp: updatedCamp });
    }
    res.status(404).json({ error: "Selected campaign not found" });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to register campaign: " + err.message });
  }
});

export default router;
