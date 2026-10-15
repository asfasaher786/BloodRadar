import { Router } from "express";
import { z } from "zod";
import { getHospitals } from "../services/dbService";

const router = Router();

const querySchema = z.object({
  city: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters" });
    }
    const { city, search } = parsed.data;
    let list = await getHospitals();

    if (city) {
      list = list.filter(h => h.city.toLowerCase() === city.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(h => h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q));
    }

    res.json(list);
  } catch (err) {
    next(err);
  }
});

export default router;
