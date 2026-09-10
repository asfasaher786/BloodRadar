import { Router } from "express";
import { getNotifications, markAllNotificationsRead } from "../services/dbService";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const list = await getNotifications();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load active notifications: " + err.message });
  }
});

router.post("/read-all", async (req, res) => {
  try {
    await markAllNotificationsRead();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to mark notifications as read: " + err.message });
  }
});

export default router;
