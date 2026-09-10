import { Router } from "express";
import { getHospitals } from "../services/dbService";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { city, search } = req.query;
    let list = await getHospitals();

    if (city) {
      list = list.filter(h => h.city.toLowerCase() === (city as string).toLowerCase());
    }

    if (search) {
      const q = (search as string).toLowerCase();
      list = list.filter(h => h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q));
    }

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load hospital directories: " + err.message });
  }
});

export default router;
