import { Router } from "express";
import { getNotifications, markAllNotificationsRead } from "../services/dbService";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const list = await getNotifications();
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/read-all", async (_req, res, next) => {
  try {
    await markAllNotificationsRead();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
