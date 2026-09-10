import { Router } from "express";
import {
  getDonors, addDonor, updateDonorAvailability, addDonorReview,
  storeOtp, checkOtp, verifyDonorByPhone, logDonation
} from "../services/dbService";
import { CONFIG } from "../config/config";
import { getEligibleDonorsForPatient } from "../lib/bloodCompatibility";
import { normalizePhone } from "../lib/phoneUtils";
import { resolveCity, getCityCenter } from "../config/regions";
export { getEligibleDonorsForPatient };

const router = Router();

router.get("/", async (req, res) => {
  try {
    const donors = await getDonors();
    res.json(donors);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load donors: " + err.message });
  }
});

router.post("/toggle-availability", async (req, res) => {
  try {
    let { phone, isAvailable } = req.body;
    phone = normalizePhone(phone);
    if (!phone) return res.status(400).json({ error: "Phone number is required to identify which donor to update" });
    const updated = await updateDonorAvailability(phone, isAvailable);
    if (updated) return res.json({ success: true, donor: updated });
    res.status(404).json({ error: "Donor profile not found" });
  } catch (err: any) {
    res.status(500).json({ error: "Error updating availability: " + err.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    let { name, bloodGroup, phone, city, location } = req.body;
    phone = normalizePhone(phone);
    if (!name || !bloodGroup || !phone) return res.status(400).json({ error: "Name, blood group, and phone number are required" });

    const newDonor = {
      id: "dnr-" + Date.now(), name, bloodGroup, phone,
      city: resolveCity(city),
      location: location || "City Central",
      latitude: getCityCenter(resolveCity(city)).latitude + (Math.random() - 0.5) * 0.05,
      longitude: getCityCenter(resolveCity(city)).longitude + (Math.random() - 0.5) * 0.05,
      isAvailable: true, isVerified: false,
      stats: { donationsCount: 1, streakCount: 1, livesSaved: 1 },
      badges: ["First-Time Savior"]
    };
    await addDonor(newDonor);
    res.json({ success: true, donor: newDonor });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to register donor: " + err.message });
  }
});

router.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    phone = normalizePhone(phone);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    storeOtp(phone, code);
    console.log(`[OTP] Verification code for ${phone}: ${code}`);
    res.json({ success: true, message: "Verification code sent.", ...(CONFIG.NODE_ENV !== "production" ? { otp: code } : {}) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send verification code: " + err.message });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    let { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "Phone number and code are required" });
    phone = normalizePhone(phone);
    const isValid = checkOtp(phone, code);
    if (!isValid) return res.status(400).json({ error: "Invalid or expired verification code" });
    const updatedDonor = await verifyDonorByPhone(phone);
    if (!updatedDonor) return res.status(404).json({ error: "No donor found with that phone number" });
    res.json({ success: true, donor: updatedDonor });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to verify donor: " + err.message });
  }
});

router.post("/log-donation", async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    phone = normalizePhone(phone);
    const result = await logDonation(phone);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, donor: result.donor });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to log donation: " + err.message });
  }
});

router.post("/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewerName, rating, comment } = req.body;
    const review = { id: "rev-" + Date.now(), reviewerName: reviewerName || "Anonymous", rating: Number(rating) || 5, comment: comment || "", date: new Date().toISOString() };
    const updated = await addDonorReview(id, review);
    if (!updated) return res.status(404).json({ error: "Donor not found" });
    res.json({ success: true, donor: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to add review: " + err.message });
  }
});

export default router;
