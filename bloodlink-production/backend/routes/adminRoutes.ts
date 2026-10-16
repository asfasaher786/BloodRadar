import { Router } from "express";
import {
  addAuditLog,
  getAuditLogs,
  getOrganizations,
  getOrganizationById,
  setOrganizationStatus,
} from "../services/dbService";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { broadcastEvent } from "../services/events";

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

// Organization applications (Phase 3). Admins are the human gate on who gets
// to post on behalf of patients and update blood-bank stock. Phone numbers
// are visible here on purpose — approving an org means vouching for its
// verified phone identity.
router.get("/orgs", authMiddleware, roleMiddleware("admin"), async (_req, res, next) => {
  try {
    const orgs = await getOrganizations();
    res.json(orgs);
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/:id/approve", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const org = await getOrganizationById(id);
    if (!org) return res.status(404).json({ error: "Organization application not found" });
    if (org.status !== "pending") {
      return res.status(409).json({ error: `This application was already ${org.status}.` });
    }
    const updated = await setOrganizationStatus(id, "approved", req.auth!.sub);
    await addAuditLog({ action: "org_approved", actor: req.auth!.sub, detail: `${org.name} (${org.type}) approved` });
    broadcastEvent("org-status-changed", { id, status: "approved" });
    res.json({ success: true, org: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/:id/reject", authMiddleware, roleMiddleware("admin"), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const org = await getOrganizationById(id);
    if (!org) return res.status(404).json({ error: "Organization application not found" });
    if (org.status !== "pending") {
      return res.status(409).json({ error: `This application was already ${org.status}.` });
    }
    const updated = await setOrganizationStatus(id, "rejected", req.auth!.sub);
    await addAuditLog({ action: "org_rejected", actor: req.auth!.sub, detail: `${org.name} (${org.type}) rejected` });
    broadcastEvent("org-status-changed", { id, status: "rejected" });
    res.json({ success: true, org: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
