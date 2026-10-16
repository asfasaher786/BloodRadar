import { MongoClient, Db } from "mongodb";
import crypto from "crypto";
import { CONFIG } from "../config/config";
import { getEligibleDonorsForPatient } from "../lib/bloodCompatibility";
import { normalizePhone, maskPhone } from "../lib/phoneUtils";
import { resolveCity } from "../config/regions";
import type { DonorResponseStats } from "./donorRanking";
import {
  preseededUsers,
  preseededDonors,
  preseededHospitals,
  preseededCamps,
  preseededEmergencies,
  preseededHistory,
  preseededNotifications
} from "../data/seedData";

// Native in-memory variables representing local fallback. Seed phones are
// normalized on load so they match OTP-verified identities (which are always
// canonical "+CC..." format). Everything seeded is flagged isSample so the
// data layer (and future analytics) can tell demo data from real records.
let memoryUsers = preseededUsers.map(u => ({ ...u, isSample: true }));
let memoryDonors = preseededDonors.map(d => ({ ...d, phone: normalizePhone(d.phone), isSample: true }));
let memoryHospitals = preseededHospitals.map(h => ({ ...h, isSample: true }));
let memoryCamps = preseededCamps.map(c => ({ ...c, isSample: true }));
let memoryEmergencies: any[] = preseededEmergencies.map(e => ({ ...e, contactPhone: e.contactPhone ? normalizePhone(e.contactPhone) : e.contactPhone, isSample: true }));
let memoryHistory = preseededHistory.map(h => ({ ...h, isSample: true }));
let memoryNotifications = preseededNotifications.map(n => ({ ...n, isSample: true }));
let memoryChats: any[] = [];
let memoryContactRequests: any[] = [];
let memoryAuditLog: any[] = [];

const otpStore = new Map();
export function storeOtp(phone, code, ttlMs = 5 * 60 * 1000) {
  otpStore.set(phone, { code, expiresAt: Date.now() + ttlMs });
}
export function checkOtp(phone, code) {
  const entry = otpStore.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { otpStore.delete(phone); return false; }
  const isMatch = entry.code === code;
  if (isMatch) otpStore.delete(phone);
  return isMatch;
}
export async function verifyDonorByPhone(phone) {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("donors").findOneAndUpdate({ phone }, { $set: { isVerified: true } }, { returnDocument: "after" });
    return result && result.value ? result.value : result;
  }
  const idx = memoryDonors.findIndex(d => d.phone === phone);
  if (idx !== -1) { memoryDonors[idx].isVerified = true; return memoryDonors[idx]; }
  return null;
}
function computeBadges(donationsCount) {
  const badges = [];
  if (donationsCount >= 1) badges.push("First-Time Savior");
  if (donationsCount >= 3) badges.push("Steady Giver");
  if (donationsCount >= 7) badges.push("Life Saver");
  if (donationsCount >= 12) badges.push("Guardian Angel");
  if (donationsCount >= 20) badges.push("Legendary Donor");
  return badges;
}
const MIN_DAYS_BETWEEN_DONATIONS = 90;

export function computeNextEligibleDate(lastDonationDate?: string): string | null {
  if (!lastDonationDate) return null;
  const d = new Date(lastDonationDate);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + MIN_DAYS_BETWEEN_DONATIONS);
  return d.toISOString().split("T")[0];
}

export async function logDonation(phone): Promise<{ error: string } | { donor: any }> {
  const { mode, db } = await getDb();
  const applyUpdate = (donor) => {
    if (donor.lastDonationDate) {
      const daysSince = (Date.now() - new Date(donor.lastDonationDate).getTime()) / 86400000;
      if (daysSince < MIN_DAYS_BETWEEN_DONATIONS) {
        return { ok: false as const, error: `You can log your next donation in about ${Math.ceil(MIN_DAYS_BETWEEN_DONATIONS - daysSince)} days — your body needs time to recover.` };
      }
    }
    const newDonationsCount = (donor.stats?.donationsCount || 0) + 1;
    const updatedStats = { donationsCount: newDonationsCount, streakCount: (donor.stats?.streakCount || 0) + 1, livesSaved: (donor.stats?.livesSaved || 0) + 3 };
    const lastDonationDate = new Date().toISOString().split("T")[0];
    return { ok: true as const, stats: updatedStats, badges: computeBadges(newDonationsCount), lastDonationDate, nextEligibleDate: computeNextEligibleDate(lastDonationDate) };
  };
  if (mode === "mongodb" && db) {
    const donor = await db.collection("donors").findOne({ phone });
    if (!donor) return { error: "No donor found with that phone number" };
    const result = applyUpdate(donor);
    if (!result.ok) return { error: result.error };
    const updated = await db.collection("donors").findOneAndUpdate({ phone }, { $set: { stats: result.stats, badges: result.badges, lastDonationDate: result.lastDonationDate, nextEligibleDate: result.nextEligibleDate } }, { returnDocument: "after" });
    return { donor: updated && (updated as any).value ? (updated as any).value : updated };
  }
  const idx = memoryDonors.findIndex(d => d.phone === phone);
  if (idx === -1) return { error: "No donor found with that phone number" };
  const result = applyUpdate(memoryDonors[idx]);
  if (!result.ok) return { error: result.error };
  Object.assign(memoryDonors[idx], { stats: result.stats, badges: result.badges, lastDonationDate: result.lastDonationDate, nextEligibleDate: result.nextEligibleDate });
  return { donor: memoryDonors[idx] };
}

// Generic small field updates on a donor (used by the reminder job).
export async function updateDonorField(phone: string, patch: Record<string, any>): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("donors").updateOne({ phone }, { $set: patch });
    return;
  }
  const idx = memoryDonors.findIndex(d => d.phone === phone);
  if (idx !== -1) Object.assign(memoryDonors[idx], patch);
}

export async function getAcceptedContactRequests(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("contactrequests").find({ status: "accepted" }).toArray();
  }
  return memoryContactRequests.filter(c => c.status === "accepted");
}


// Mongo helpers
let mongoClient: MongoClient | null = null;
let db: Db | null = null;
let isConnected = false;

// Attempt database connection lazy-loaded on request or on startup
export async function getDb(): Promise<{ mode: "mongodb" | "fallback"; db: Db | null }> {
  if (!CONFIG.MONGO_URI) {
    return { mode: "fallback", db: null };
  }

  if (isConnected && db) {
    return { mode: "mongodb", db };
  }

  try {
    mongoClient = new MongoClient(CONFIG.MONGO_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });
    await mongoClient.connect();
    db = mongoClient.db("bloodradar");
    isConnected = true;
    console.log("Successfully connected to MongoDB Atlas database.");

    // Seed empty collections
    await seedMongoDbIfEmpty(db);
    await ensureIndexes(db);

    return { mode: "mongodb", db };
  } catch (err) {
    console.error("MongoDB connection failed, falling back to local memory store:", err);
    isConnected = false;
    db = null;
    return { mode: "fallback", db: null };
  }
}

async function seedMongoDbIfEmpty(database: Db) {
  try {
    const list = await database.listCollections().toArray();
    const names = list.map(c => c.name);

    if (!names.includes("users") || (await database.collection("users").countDocuments()) === 0) {
      await database.collection("users").insertMany(preseededUsers.map(u => ({ ...u, isSample: true })));
      console.log("Seeded users collection in MongoDB");
    }

    if (!names.includes("donors") || (await database.collection("donors").countDocuments()) === 0) {
      await database.collection("donors").insertMany(preseededDonors.map(d => ({ ...d, phone: normalizePhone(d.phone), isSample: true })));
      console.log("Seeded donors collection in MongoDB");
    }

    if (!names.includes("hospitals") || (await database.collection("hospitals").countDocuments()) === 0) {
      await database.collection("hospitals").insertMany(preseededHospitals.map(h => ({ ...h, isSample: true })));
      console.log("Seeded hospitals collection in MongoDB");
    }

    if (!names.includes("camps") || (await database.collection("camps").countDocuments()) === 0) {
      await database.collection("camps").insertMany(preseededCamps.map(c => ({ ...c, isSample: true })));
      console.log("Seeded camps collection in MongoDB");
    }

    if (!names.includes("emergencies") || (await database.collection("emergencies").countDocuments()) === 0) {
      if (preseededEmergencies.length > 0) {
        await database.collection("emergencies").insertMany(preseededEmergencies.map(e => ({ ...e, isSample: true })));
        console.log("Seeded emergencies collection in MongoDB");
      }
    }

    if (!names.includes("history") || (await database.collection("history").countDocuments()) === 0) {
      await database.collection("history").insertMany(preseededHistory.map(h => ({ ...h, isSample: true })));
      console.log("Seeded history collection in MongoDB");
    }

    if (!names.includes("notifications") || (await database.collection("notifications").countDocuments()) === 0) {
      await database.collection("notifications").insertMany(preseededNotifications.map(n => ({ ...n, isSample: true })));
      console.log("Seeded notifications collection in MongoDB");
    }
  } catch (error) {
    console.error("Failed to seed MongoDB:", error);
  }
}

// Indexes from the master prompt, plus a few the query patterns demand.
// Phone uniqueness is the data-level guarantee that one phone = one donor.
async function ensureIndexes(database: Db) {
  try {
    await database.collection("donors").createIndex({ phone: 1 }, { unique: true });
    await database.collection("donors").createIndex({ city: 1, bloodGroup: 1, isAvailable: 1 });
    await database.collection("emergencies").createIndex({ status: 1, createdAt: -1 });
    await database.collection("otps").createIndex({ phone: 1 }, { unique: true });
    // TTL: OTP records self-destruct ~5 minutes after expiry.
    await database.collection("otps").createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
    await database.collection("contactrequests").createIndex({ donorPhone: 1, status: 1 });
    await database.collection("contactrequests").createIndex({ sosId: 1, status: 1 });
    await database.collection("auditlog").createIndex({ timestamp: -1 });
  } catch (error) {
    // Index creation failing must not kill the fallback path — log and move on.
    console.error("Failed to create MongoDB indexes:", error);
  }
}

// Global accessor CRUD APIs spanning both Mongo and Local Fallback store

export async function getUsers(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("users").find({}).toArray();
  }
  return memoryUsers;
}

export async function addUser(user: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("users").insertOne(user);
    return;
  }
  memoryUsers.push(user);
}

export async function getDonors(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("donors").find({}).toArray();
  }
  return memoryDonors;
}

export async function getDonorByPhone(phone: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("donors").findOne({ phone });
  }
  return memoryDonors.find(d => d.phone === phone) || null;
}

export async function addDonor(donor: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const existing = await db.collection("donors").findOne({ phone: donor.phone });
    if (existing) throw new Error("A donor with this phone number is already registered.");
    await db.collection("donors").insertOne(donor);
    return;
  }
  if (memoryDonors.some(d => d.phone === donor.phone)) {
    throw new Error("A donor with this phone number is already registered.");
  }
  memoryDonors.push(donor);
}

export async function updateDonorAvailability(phone: string, isAvailable: boolean): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("donors").findOneAndUpdate(
      { phone },
      { $set: { isAvailable } },
      { returnDocument: "after" }
    );
    // Handle older driver compatibility where result could be wrapped or containing .value
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryDonors.findIndex(d => d.phone === phone);
  if (idx !== -1) {
    memoryDonors[idx].isAvailable = isAvailable;
    return memoryDonors[idx];
  }
  return null;
}

export async function addDonorReview(donorId: string, review: any): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("donors").findOneAndUpdate(
      { id: donorId },
      { $push: { reviews: { $each: [review], $position: 0 } } as any },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryDonors.findIndex(d => d.id === donorId);
  if (idx !== -1) {
    if (!memoryDonors[idx].reviews) memoryDonors[idx].reviews = [];
    memoryDonors[idx].reviews.unshift(review);
    return memoryDonors[idx];
  }
  return null;
}

export async function getHospitals(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("hospitals").find({}).toArray();
  }
  return memoryHospitals;
}

export async function getCamps(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("camps").find({}).toArray();
  }
  return memoryCamps;
}

export async function incrementCampRegistration(campId: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("camps").findOneAndUpdate(
      { id: campId },
      { $inc: { registeredCount: 1 } },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryCamps.findIndex(c => c.id === campId);
  if (idx !== -1) {
    memoryCamps[idx].registeredCount += 1;
    return memoryCamps[idx];
  }
  return null;
}

export async function getEmergencies(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("emergencies").find({}).sort({ createdAt: -1 }).toArray();
  }
  return memoryEmergencies;
}

export async function addEmergency(sos: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("emergencies").insertOne(sos);
    return;
  }
  memoryEmergencies.unshift(sos);
}

export async function createEmergencyRequest(input) {
  if (!input.contactPhone) return { error: "A contact phone number is required." };

  // Abuse controls (Phase 3): a real person rarely raises the same need
  // twice, and never many times in a day — both patterns are spam.
  const normalizedRequester = normalizePhone(input.contactPhone);
  const allEmergencies = await getEmergencies();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Duplicate detection: same phone + same blood group + still Pending.
  // This is the honest answer to a double-tap or retry — "we found your
  // open request" instead of broadcasting the same SOS twice.
  const duplicate = allEmergencies.find(e =>
    normalizePhone(e.contactPhone || "") === normalizedRequester &&
    e.bloodGroup === (input.bloodGroup || "O-") &&
    e.status === "Pending"
  );
  if (duplicate) return { duplicate: true, existing: duplicate };

  // Per-phone cap: max 3 SOS per phone per 24 hours (the IP-level rate
  // limiter covers bursts; this covers rotating IPs / shared networks).
  const recentFromThisPhone = allEmergencies.filter(e =>
    normalizePhone(e.contactPhone || "") === normalizedRequester &&
    new Date(e.createdAt).getTime() > dayAgo
  );
  if (recentFromThisPhone.length >= 3) {
    return {
      error: "You have raised several requests in the last 24 hours. For further requests, please call the hospital directly.",
      code: "PHONE_LIMIT",
    };
  }

  const hospitals = await getHospitals();
  const requestCity = resolveCity(input.city);
  const selectedHospital = hospitals.find(h => h.id === input.hospitalId) || hospitals.find(h => h.city === requestCity) || hospitals[0];
  const donors = await getDonors();
  const effectiveBloodGroup = input.bloodGroup || "O-";
  const eligibleDonorTypes = getEligibleDonorsForPatient(effectiveBloodGroup);
  const potentialMatches = donors.filter(d => eligibleDonorTypes.includes(d.bloodGroup) && d.isAvailable && d.city.toLowerCase() === requestCity.toLowerCase());
  // One-time code proving the requester owns this SOS. Used by the contact-
  // request and reveal endpoints — the only way a requester (who never logs
  // in) can prove they are the same person who raised the SOS.
  const requesterCode = crypto.randomBytes(6).toString("hex");
  const sos = {
    id: "sos-" + Date.now(),
    patientName: input.patientName || "Patient (name not given)",
    bloodGroup: effectiveBloodGroup,
    unitsNeeded: Number(input.unitsNeeded) || 1,
    hospitalId: selectedHospital.id,
    hospitalName: selectedHospital.name,
    contactPhone: input.contactPhone,
    requiredBy: input.requiredBy || new Date(Date.now() + 86400000).toISOString().split("T")[0],
    reason: input.reason || "Surgical critical emergency",
    urgency: input.urgency || "Immediate (SOS)",
    status: "Pending",
    city: requestCity,
    createdAt: new Date().toISOString(),
    matchingDonorsCount: potentialMatches.length,
    requesterCode
  };
  await addEmergency(sos);
  await addNotification({
    id: "notif-" + Date.now(),
    title: `🚨 SOS BROADCAST: ${sos.bloodGroup} Urgent Request`,
    // Masked on purpose: the public notification must never leak the
    // requester's full number. Reveal happens only through the
    // contact-request → accept flow.
    message: `${sos.unitsNeeded} units of ${sos.bloodGroup} required urgently for ${sos.patientName} at ${sos.hospitalName}. Requested contact: ${maskPhone(sos.contactPhone)}. Open the SOS to respond.`,
    type: "emergency",
    timestamp: new Date().toISOString(),
    read: false
  });
  await addAuditLog({ action: "sos_created", actor: sos.contactPhone, sosId: sos.id, detail: `SOS raised for ${sos.bloodGroup} at ${sos.hospitalName}` });
  return { sos, requesterCode };
}

export async function updateEmergencyStatus(sosId: string, status: "Pending" | "Fulfilled" | "Cancelled"): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("emergencies").findOneAndUpdate(
      { id: sosId },
      { $set: { status } },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryEmergencies.findIndex(e => e.id === sosId);
  if (idx !== -1) {
    memoryEmergencies[idx].status = status;
    return memoryEmergencies[idx];
  }
  return null;
}

export async function getNotifications(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("notifications").find({}).sort({ timestamp: -1 }).toArray();
  }
  return memoryNotifications;
}

export async function addNotification(notification: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("notifications").insertOne(notification);
    return;
  }
  memoryNotifications.unshift(notification);
}

export async function markAllNotificationsRead(): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("notifications").updateMany({}, { $set: { read: true } });
    return;
  }
  memoryNotifications = memoryNotifications.map(n => ({ ...n, read: true }));
}

// ---------------------------------------------------------------
// Contact-reveal flow (privacy core): requester raises SOS → sends
// contact request → matching donors get inbox items → donor accepts →
// both parties' real numbers are revealed to each other, with an
// audit trail. Nobody's full phone number is public anywhere.
// ---------------------------------------------------------------

export async function getEmergencyById(sosId: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("emergencies").findOne({ id: sosId });
  }
  return memoryEmergencies.find(e => e.id === sosId) || null;
}

export async function deleteEmergency(sosId: string): Promise<boolean> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("emergencies").deleteOne({ id: sosId });
    return result.deletedCount > 0;
  }
  const idx = memoryEmergencies.findIndex(e => e.id === sosId);
  if (idx === -1) return false;
  memoryEmergencies.splice(idx, 1);
  return true;
}

// Abuse controls (Phase 3): anyone can report a suspicious request.
// Reports accumulate on the SOS and are audited; admins moderate in the
// dashboard. Reason is sanitized by the caller and capped at 200 chars.
export async function addEmergencyReport(sosId: string, reason: string): Promise<{ ok: boolean; found: boolean }> {
  const entry = { at: new Date().toISOString(), reason };
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    // The driver's conditional operator types collapse to `never` for
    // untyped schemas; the value is a plain serializable object.
    const result = await db.collection("emergencies").updateOne(
      { id: sosId },
      { $push: { reports: entry } } as any
    );
    return { ok: result.matchedCount > 0, found: result.matchedCount > 0 };
  }
  const sos = memoryEmergencies.find(e => e.id === sosId);
  if (!sos) return { ok: false, found: false };
  sos.reports = [...(sos.reports || []), entry];
  return { ok: true, found: true };
}

// Creates one open contact request per matching donor for the given SOS.
// Returns the list of created requests (donor inbox items).
export async function createContactRequestsForSos(sos: any): Promise<any[]> {
  const donors = await getDonors();
  const eligibleDonorTypes = getEligibleDonorsForPatient(sos.bloodGroup);
  const matches = donors.filter(d =>
    eligibleDonorTypes.includes(d.bloodGroup) &&
    d.isAvailable &&
    d.city.toLowerCase() === (sos.city || "").toLowerCase()
  );

  const requests = matches.map((d, i) => ({
    id: "cr-" + Date.now() + "-" + i,
    sosId: sos.id,
    requesterPhone: sos.contactPhone,
    donorPhone: d.phone,
    status: "open",
    createdAt: new Date().toISOString(),
  }));

  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    if (requests.length > 0) await db.collection("contactrequests").insertMany(requests);
  } else {
    memoryContactRequests.push(...requests);
  }
  return requests;
}

export async function getContactRequestById(id: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("contactrequests").findOne({ id });
  }
  return memoryContactRequests.find(c => c.id === id) || null;
}

// Per-donor response stats for transparent ranking: accepted / decided
// (declined + expired). Superseded requests are NOT the donor's fault —
// someone else accepted first — so they never count against a donor.
export async function getContactRequestStats(): Promise<Record<string, DonorResponseStats>> {
  const { mode, db } = await getDb();
  const all = mode === "mongodb" && db
    ? await db.collection("contactrequests").find({}).toArray()
    : memoryContactRequests;
  const out: Record<string, DonorResponseStats> = {};
  for (const c of all as any[]) {
    const key = c.donorPhone;
    if (!out[key]) out[key] = { accepted: 0, declined: 0, expired: 0, superseded: 0 };
    const status = c.status || "open";
    if (status === "accepted") out[key].accepted += 1;
    else if (status === "declined") out[key].declined += 1;
    else if (status === "expired") out[key].expired += 1;
    else if (status === "superseded") out[key].superseded += 1;
  }
  return out;
}

export async function getInboxForDonor(phone: string): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("contactrequests").find({ donorPhone: phone }).sort({ createdAt: -1 }).toArray();
  }
  return memoryContactRequests
    .filter(c => c.donorPhone === phone)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// First accept wins: marks this request accepted and supersedes every other
// open request for the same SOS so only one donor's number is revealed to
// the requester (the person whose help was actually taken).
export async function acceptContactRequest(id: string, donorPhone: string): Promise<{ error: string } | { request: any }> {
  const { mode, db } = await getDb();
  const request = await getContactRequestById(id);
  if (!request) return { error: "Contact request not found." };
  if (request.donorPhone !== donorPhone) return { error: "This request is not for your account." };
  if (request.status !== "open") {
    return { error: request.status === "accepted" ? "You already accepted this request." : "This request is no longer open (someone may have responded first)." };
  }

  const acceptedAt = new Date().toISOString();
  if (mode === "mongodb" && db) {
    await db.collection("contactrequests").updateOne({ id }, { $set: { status: "accepted", acceptedAt } });
    await db.collection("contactrequests").updateMany(
      { sosId: request.sosId, id: { $ne: id }, status: "open" },
      { $set: { status: "superseded" } }
    );
  } else {
    const idx = memoryContactRequests.findIndex(c => c.id === id);
    memoryContactRequests[idx] = { ...memoryContactRequests[idx], status: "accepted", acceptedAt };
    memoryContactRequests = memoryContactRequests.map(c =>
      c.sosId === request.sosId && c.id !== id && c.status === "open"
        ? { ...c, status: "superseded" }
        : c
    );
  }

  await addAuditLog({
    action: "contact_request_accepted",
    actor: donorPhone,
    target: request.requesterPhone,
    sosId: request.sosId,
    detail: "Donor accepted — both parties' phone numbers revealed to each other",
  });

  const updated = await getContactRequestById(id);
  return { request: updated };
}

export async function declineContactRequest(id: string, donorPhone: string): Promise<{ error: string } | { request: any }> {
  const request = await getContactRequestById(id);
  if (!request) return { error: "Contact request not found." };
  if (request.donorPhone !== donorPhone) return { error: "This request is not for your account." };
  if (request.status !== "open") return { error: "This request is no longer open." };

  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("contactrequests").updateOne({ id }, { $set: { status: "declined" } });
  } else {
    const idx = memoryContactRequests.findIndex(c => c.id === id);
    memoryContactRequests[idx] = { ...memoryContactRequests[idx], status: "declined" };
  }

  await addAuditLog({ action: "contact_request_declined", actor: donorPhone, sosId: request.sosId, detail: "Donor declined the contact request" });
  return { request: await getContactRequestById(id) };
}

export async function getFulfilledContactRequestForSos(sosId: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("contactrequests").findOne({ sosId, status: "accepted" });
  }
  return memoryContactRequests.find(c => c.sosId === sosId && c.status === "accepted") || null;
}

export async function addAuditLog(entry: any): Promise<void> {
  const record = { id: "aud-" + Date.now() + "-" + Math.floor(Math.random() * 10000), timestamp: new Date().toISOString(), ...entry };
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("auditlog").insertOne(record);
    return;
  }
  memoryAuditLog.unshift(record);
}

export async function getAuditLogs(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("auditlog").find({}).sort({ timestamp: -1 }).limit(500).toArray();
  }
  return memoryAuditLog;
}

export async function getChatSessionHistory(sid: string): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const records = await db.collection("chats").find({ sessionId: sid }).toArray();
    return records.map(r => r.message);
  }
  return memoryChats.filter(c => c.sessionId === sid).map(r => r.message);
}

export async function addChatMessage(sid: string, message: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("chats").insertOne({ sessionId: sid, message, timestamp: new Date() });
    return;
  }
  memoryChats.push({ sessionId: sid, message, timestamp: new Date() });
}
