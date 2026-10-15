import { Router } from "express";
import { getDonors, getHospitals, getCamps, getEmergencies, getAcceptedContactRequests, getEmergencyById } from "../services/dbService";

const router = Router();

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Real aggregate stats computed live from the actual database — no padded
// or fabricated numbers. If a number looks unimpressive, that's honest
// information, not something to inflate for show.
router.get("/", async (_req, res, next) => {
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

    // Time-to-first-contact: from SOS created to the first donor accepting,
    // computed only from REAL accepted contact requests. null until data
    // exists — never fabricated.
    const acceptedRequests = await getAcceptedContactRequests();
    const responseTimesMs: number[] = [];
    for (const a of acceptedRequests) {
      const sos = await getEmergencyById(a.sosId);
      if (!sos || !sos.createdAt || !a.acceptedAt) continue;
      const ms = new Date(a.acceptedAt).getTime() - new Date(sos.createdAt).getTime();
      if (ms >= 0) responseTimesMs.push(ms);
    }

    res.json({
      totals: {
        totalDonors: donors.length,
        activeSOS,
        fulfilledSOS,
        registeredCamps: camps.length
      },
      bloodDistribution,
      hospitalAvailability,
      medianTimeToFirstContactMs: median(responseTimesMs)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
