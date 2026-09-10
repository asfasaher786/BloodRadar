import { Router } from "express";
import { getEmergencies, updateEmergencyStatus, createEmergencyRequest } from "../services/dbService";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const list = await getEmergencies();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load emergency SOS listing: " + err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { patientName, bloodGroup, unitsNeeded, hospitalId, contactPhone, requiredBy, reason, urgency, city } = req.body;
    const result = await createEmergencyRequest({ contactPhone, patientName, bloodGroup, unitsNeeded, hospitalId, requiredBy, reason, urgency, city });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, request: result.sos });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to raise SOS emergency: " + err.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await updateEmergencyStatus(id, status);
    if (!updated) return res.status(404).json({ error: "Emergency request not found" });
    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update emergency status: " + err.message });
  }
});

export default router;
