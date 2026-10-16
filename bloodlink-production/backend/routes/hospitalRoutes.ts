import { Router } from "express";
import { z } from "zod";
import { getApprovedOrganizationForPhone, getHospitals, updateHospitalStock } from "../services/dbService";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { addAuditLog } from "../services/dbService";
import { broadcastEvent } from "../services/events";

const router = Router();

const querySchema = z.object({
  city: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
});

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;
const STOCK_LEVELS = ["In Stock", "Low", "Critical", "Out of Stock"] as const;

// Stock updates come only from the approved blood-bank organization linked
// to THIS hospital. The availability map is partial — a bank can update one
// group without re-entering the rest — and every update stamps the review
// date so the public "stock last reviewed" line is a real timestamp.
// (zod v4 turns an enum-keyed record into an exact object demanding every
// key, so groups are validated in a refine instead.)
const stockSchema = z.object({
  availability: z
    .record(z.string(), z.enum(STOCK_LEVELS))
    .refine((v) => Object.keys(v).length > 0, "At least one blood group is required")
    .refine(
      (v) => Object.keys(v).every((k) => (BLOOD_GROUPS as readonly string[]).includes(k)),
      `Blood groups must be one of ${BLOOD_GROUPS.join(", ")}`
    ),
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

router.put("/:id/stock", authMiddleware, roleMiddleware("hospital_staff"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Hospital id is required" });

    const parsed = stockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid stock payload" });
    }

    const org = await getApprovedOrganizationForPhone(req.auth!.sub);
    if (!org || org.type !== "hospital" || org.hospitalId !== id) {
      return res.status(403).json({ error: "Only the approved blood-bank organization of this hospital can update its stock." });
    }

    const hospital = await getHospitals().then(list => list.find(h => h.id === id));
    if (!hospital) return res.status(404).json({ error: "Hospital not found" });

    const updated = await updateHospitalStock(id, parsed.data.availability as Record<string, string>);
    await addAuditLog({
      action: "stock_updated",
      actor: req.auth!.sub,
      detail: `${org.name} updated stock for ${hospital.name} (${Object.keys(parsed.data.availability).length} groups)`,
    });
    broadcastEvent("stock-updated", { id });
    res.json({ success: true, hospital: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
