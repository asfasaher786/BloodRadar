import { Router } from "express";
import { getDonors, getHospitals, getCamps, getEmergencies } from "../services/dbService";

const router = Router();

// Real aggregate stats computed live from the actual database — no padded
// or fabricated numbers. If a number looks unimpressive, that's honest
// information, not something to inflate for show.
router.get("/", async (req, res) => {
  try {
    const [donors, hospitals, camps, emergencies] = await Promise.all([
      getDonors(), getHospitals(), getCamps(), getEmergencies()
    ]);

    const activeSOS = emergencies.filter((e: any) => e.status === "Pending").length;
    const fulfilledSOS = emergencies.filter((e: any) => e.status === "Fulfilled").length;

    const bloodGroupCounts: { [key: string]: number } = {};
    for (const d of donors) {
      bloodGroupCounts[d.bloodGroup] = (bloodGroupCounts[d.bloodGroup] || 0) + 1;
    }
    const bloodDistribution = Object.entries(bloodGroupCounts).map(([bloodGroup, count]) => ({ bloodGroup, count }));

    const hospitalAvailability = hospitals.map((h: any) => {
      const groups = Object.values(h.bloodAvailability || {});
      const inStock = groups.filter((s: any) => s === "In Stock").length;
      const criticalOrLow = groups.filter((s: any) => s === "Critical" || s === "Low" || s === "Out of Stock").length;
      return { name: h.name, "In Stock Groups": inStock, "Critical/Low Groups": criticalOrLow };
    });

    res.json({
      totals: {
        totalDonors: donors.length,
        activeSOS,
        fulfilledSOS,
        registeredCamps: camps.length
      },
      bloodDistribution,
      hospitalAvailability
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to compute stats: " + err.message });
  }
});

export default router;
