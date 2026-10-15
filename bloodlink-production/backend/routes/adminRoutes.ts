import { Router } from "express";
import { getAuditLogs } from "../services/dbService";
import { authMiddleware, roleMiddleware } from "../middleware/auth";

// Admin-only endpoints. Everything here is gated by role "admin" — a role
// granted at login only to OTP-verified phones listed in ADMIN_PHONES.
const router = Router();

// Audit trail of privacy-sensitive actions (SOS created, contact requests
// accepted/declined). Server-side only; never shown in public UI.
router.get("/audit", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const logs = await getAuditLogs();
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
