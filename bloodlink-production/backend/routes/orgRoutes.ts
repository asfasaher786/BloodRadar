import { Router } from "express";
import { z } from "zod";
import {
  addOrganization,
  getApprovedOrganizationForPhone,
  getEmergencies,
  getHospitals,
  getOrganizationForPhone,
} from "../services/dbService";
import { authMiddleware, roleMiddleware } from "../middleware/auth";
import { addAuditLog } from "../services/dbService";
import { resolveCity } from "../config/regions";
import { sanitizeText } from "../lib/sanitize";
import { maskPhone } from "../lib/phoneUtils";

// Organization portal (Phase 3, lightweight). A verified phone applies as an
// NGO or hospital organization; an admin approves it. Approved orgs post SOS
// on behalf of patients and close their own requests; hospital orgs can also
// update their blood bank's stock. Nothing here is public — every route is
// authenticated, and admin actions live in adminRoutes.
const router = Router();

const applySchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80, "Organization name looks too long"),
  type: z.enum(["ngo", "hospital"]),
  city: z.string().trim().max(50).optional(),
  hospitalId: z.string().trim().max(80).optional(),
});

// The org record as the applicant/admin sees it (owner phone masked in
// admin lists later; here the caller owns it).
function publicOrg(org: any) {
  if (!org) return null;
  const { ...rest } = org;
  return { ...rest, contactPhone: maskPhone(org.contactPhone), phoneMasked: true };
}

// Apply to register an organization. One organization per verified phone —
// the phone identity IS the org account. Re-applying returns the existing
// record with its current status so the UI can show "awaiting review".
router.post("/apply", authMiddleware, async (req, res, next) => {
  try {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid application" });
    }
    const d = parsed.data;
    const phone = req.auth!.sub;

    const existing = await getOrganizationForPhone(phone);
    if (existing) {
      return res.status(409).json({ error: "An organization application already exists for this phone number.", org: publicOrg(existing) });
    }

    // Hospital orgs must be linked to a real hospital from the directory —
    // that link is what authorizes stock updates later.
    let hospitalId: string | undefined;
    let hospitalName: string | undefined;
    if (d.type === "hospital") {
      const hospitals = await getHospitals();
      const hospital = hospitals.find(h => h.id === d.hospitalId);
      if (!hospital) {
        return res.status(400).json({ error: "A hospital organization must select the hospital it operates from the directory." });
      }
      hospitalId = hospital.id;
      hospitalName = hospital.name;
    }

    const org = {
      id: "org-" + Date.now(),
      name: sanitizeText(d.name, 80),
      type: d.type,
      city: resolveCity(d.city || undefined),
      hospitalId,
      hospitalName,
      contactPhone: phone,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await addOrganization(org);
    await addAuditLog({ action: "org_apply", actor: phone, detail: `${org.name} (${org.type}) applied from ${phone}` });
    res.status(201).json({ success: true, org: publicOrg(org) });
  } catch (err) {
    next(err);
  }
});

// The logged-in phone's own application/org record (any status).
router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const org = await getOrganizationForPhone(req.auth!.sub);
    res.json({ org: publicOrg(org) });
  } catch (err) {
    next(err);
  }
});

// Requests this approved organization posted on behalf of patients.
// Own-requests only: a staff member can close exactly the SOS their own
// org raised — never anyone else's.
router.get("/requests", authMiddleware, roleMiddleware("ngo", "hospital_staff"), async (req, res, next) => {
  try {
    const org = await getApprovedOrganizationForPhone(req.auth!.sub);
    if (!org) {
      return res.status(403).json({ error: "Your organization is not approved yet." });
    }
    const all = await getEmergencies();
    const mine = all
      .filter(e => e.orgId === org.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(mine.map(e => {
      const { requesterCode: _code, reports: _reports, ...rest } = e;
      return { ...rest, contactPhone: maskPhone(e.contactPhone), phoneMasked: true };
    }));
  } catch (err) {
    next(err);
  }
});

export default router;
