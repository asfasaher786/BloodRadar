import { Router } from "express";
import { getUsers, addUser } from "../services/dbService";
import { resolveCity } from "../config/regions";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { email } = req.body;
    const users = await getUsers();
    const existing = users.find(u => u.email.toLowerCase() === (email || "").toLowerCase());
    
    if (existing) {
      return res.json({
        success: true,
        token: "bloodradar_jwt_token_safeer_khan_secret",
        user: existing
      });
    }

    // Auto registration fallback for simplified showcase login
    const newUser = {
      id: "usr-" + Date.now(),
      name: "Regular Volunteer (" + (email || "Visitor").split("@")[0] + ")",
      email: email || "volunteer@bloodradar.pk",
      phone: "+92 315 1212121",
      bloodGroup: "B+",
      location: "F-6, Islamabad",
      city: "Islamabad" as const,
      isDonor: false
    };
    
    await addUser(newUser);

    res.json({
      success: true,
      token: "bloodradar_jwt_token_new_volunteer",
      user: newUser
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to authenticate users: " + error.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, bloodGroup, location, city, isDonor } = req.body;
    
    if (!name || !email || !bloodGroup) {
      return res.status(400).json({ error: "Missing required fields: name, email, and bloodGroup" });
    }

    const users = await getUsers();
    const alreadyExists = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (alreadyExists) {
      return res.status(400).json({ error: "Email is already registered" });
    }

    const newUser = {
      id: "usr-" + Date.now(),
      name,
      email,
      phone: phone || "+92 300 0000000",
      bloodGroup,
      location: location || "Islamabad Central",
      city: resolveCity(city),
      isDonor: !!isDonor
    };

    await addUser(newUser);

    if (isDonor) {
      const { addDonor } = await import("../services/dbService");
      await addDonor({
        id: "dnr-" + Date.now(),
        name,
        bloodGroup,
        phone: phone || "+92 300 0000000",
        city: newUser.city,
        location: location || "Islamabad Central",
        latitude: newUser.city === 'Islamabad' ? 33.6844 + (Math.random() - 0.5) * 0.1 : 33.5651 + (Math.random() - 0.5) * 0.1,
        longitude: newUser.city === 'Islamabad' ? 73.0479 + (Math.random() - 0.5) * 0.1 : 73.0169 + (Math.random() - 0.5) * 0.1,
        isAvailable: true,
        stats: { donationsCount: 0, streakCount: 0, livesSaved: 0 },
        badges: ["Young blood"]
      });
    }

    res.json({
      success: true,
      token: "bloodradar_jwt_token_" + newUser.id,
      user: newUser
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to register new volunteer: " + error.message });
  }
});

router.get("/me", async (req, res) => {
  try {
    const users = await getUsers();
    res.json({
      user: users[0] // Return Dr. Safeer by default to simulate authentication in demo mode
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to load current identity profile: " + error.message });
  }
});

export default router;
