import { MongoClient, Db } from "mongodb";
import crypto from "crypto";
import { CONFIG } from "../config/config";
import { getEligibleDonorsForPatient } from "../lib/bloodCompatibility";
import { normalizePhone, maskPhone } from "../lib/phoneUtils";
import { resolveCity } from "../config/regions";
import { resolveNeighbourhood } from "../config/neighbourhoods";
import { haversineKm } from "../lib/geo";
import { detectSuspiciousFlags } from "../lib/sosFlags";
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
let memoryDonors: any[] = preseededDonors.map(d => ({ ...d, phone: normalizePhone(d.phone), isSample: true }));
let memoryHospitals: any[] = preseededHospitals.map(h => ({ ...h, isSample: true }));
let memoryCamps = preseededCamps.map(c => ({ ...c, isSample: true }));
let memoryEmergencies: any[] = preseededEmergencies.map(e => ({ ...e, contactPhone: e.contactPhone ? normalizePhone(e.contactPhone) : e.contactPhone, isSample: true }));
let memoryHistory = preseededHistory.map(h => ({ ...h, isSample: true }));
let memoryNotifications: any[] = preseededNotifications.map(n => ({ ...n, isSample: true }));
let memoryChats: any[] = [];
let memoryContactRequests: any[] = [];
let memoryAuditLog: any[] = [];
let memoryOrganizations: any[] = [];
let memoryPushSubscriptions: any[] = [];
// P3a-6: phones an admin has blocked (one-tap from the review queue).
// Blocked phones cannot raise new SOS requests.
let memoryBlockedPhones: any[] = [];
// P3a-8: admin two-step security records (TOTP secret, recovery-code hashes,
// known devices). Real records only — never seeded, never fabricated.
let memoryAdminSecurity: any[] = [];

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
    // Atomic conditional update: the 90-day eligibility check lives in the
    // FILTER and the counters increment via pipeline expressions, so there
    // is no read-then-write window for concurrent logDonation calls to
    // double-count. A pipeline update lets the badges stage read the
    // post-increment count inside the same atomic operation.
    const today = new Date().toISOString().split("T")[0];
    const cutoffDate = new Date(Date.now() - MIN_DAYS_BETWEEN_DONATIONS * 86400000).toISOString().split("T")[0];
    const badgeBranches = [
      { case: { $gte: ["$stats.donationsCount", 20] }, then: ["First-Time Savior", "Steady Giver", "Life Saver", "Guardian Angel", "Legendary Donor"] },
      { case: { $gte: ["$stats.donationsCount", 12] }, then: ["First-Time Savior", "Steady Giver", "Life Saver", "Guardian Angel"] },
      { case: { $gte: ["$stats.donationsCount", 7] }, then: ["First-Time Savior", "Steady Giver", "Life Saver"] },
      { case: { $gte: ["$stats.donationsCount", 3] }, then: ["First-Time Savior", "Steady Giver"] },
      { case: { $gte: ["$stats.donationsCount", 1] }, then: ["First-Time Savior"] },
    ];
    const updated = await db.collection("donors").findOneAndUpdate(
      {
        phone,
        $or: [
          { lastDonationDate: { $exists: false } },
          { lastDonationDate: { $lt: cutoffDate } },
        ],
      },
      [
        {
          $set: {
            "stats.donationsCount": { $add: [{ $ifNull: ["$stats.donationsCount", 0] }, 1] },
            "stats.streakCount": { $add: [{ $ifNull: ["$stats.streakCount", 0] }, 1] },
            "stats.livesSaved": { $add: [{ $ifNull: ["$stats.livesSaved", 0] }, 3] },
            lastDonationDate: today,
            nextEligibleDate: computeNextEligibleDate(today),
          },
        },
        { $set: { badges: { $switch: { branches: badgeBranches, default: [] } } } },
      ],
      { returnDocument: "after" }
    );
    const value = updated && (updated as any).value ? (updated as any).value : updated;
    if (value) return { donor: value };
    // No match: either no donor with this phone, or the 90-day gap blocked
    // the filter. Distinguish for an honest error message.
    const donor = await db.collection("donors").findOne({ phone });
    if (!donor) return { error: "No donor found with that phone number" };
    const daysSince = donor.lastDonationDate
      ? (Date.now() - new Date(donor.lastDonationDate).getTime()) / 86400000
      : Number.POSITIVE_INFINITY;
    return { error: `You can log your next donation in about ${Math.ceil(MIN_DAYS_BETWEEN_DONATIONS - daysSince)} days — your body needs time to recover.` };
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

// P0-3: sample/demo rows (seeded with isSample: true) are excluded from
// every shared read in production unless the caller explicitly opts in —
// which only admin routes do. Fail-closed: a new read path that forgets
// the flag serves real data only, never demo data.
// P0-5: pending SOS requests auto-expire after SOS_EXPIRY_HOURS (default
// 48h). Read at call time from env so tests can shorten the window.
function sosTtlMs(): number {
  const raw = Number(process.env.SOS_EXPIRY_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : 48;
  return hours * 60 * 60 * 1000;
}

// P3b-10: an Expired (48h auto-close) request keeps its contact phone for
// this grace window so the requester can re-confirm ("still need blood?")
// and reopen it. After that the number is purged too — replaced with the
// masked form on the SOS row and on every contact-request copy.
const EXPIRED_PHONE_PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// Retention ceilings (P3b-10), applied lazily on read/write like the SOS
// expiry above — no cron infra needed and the policy page can honestly cite
// real limits.
const AUDIT_RETENTION_DAYS = 365;
const CHAT_RETENTION_DAYS = 90;

function isStalePending(row: any, now: number): boolean {
  if (row.status !== "Pending") return false;
  // expiresAt is stored as an ISO string — parse before comparing, and fall
  // back to createdAt + TTL for legacy/seeded rows that predate P0-5.
  let base = 0;
  if (row.expiresAt) {
    const t = new Date(row.expiresAt).getTime();
    if (Number.isFinite(t)) base = t;
  }
  if (!base && row.createdAt) {
    const t = new Date(row.createdAt).getTime();
    if (Number.isFinite(t)) base = t + sosTtlMs();
  }
  return base > 0 && now > base;
}

// Lazy expiry: applies the 48h auto-expiry to pending rows on every read —
// no cron required, and the board never shows a stale "live" request.
// Returns the list with freshly expired rows flipped to "Expired" (and
// persisted), plus their ids for the caller to broadcast.
async function expireStale(list: any[]): Promise<string[]> {
  const now = Date.now();
  const expiredIds: string[] = [];
  const purgeIds: string[] = [];
  for (const row of list) {
    if (isStalePending(row, now)) {
      expiredIds.push(row.id);
      row.status = "Expired";
      row.expiredAt = new Date(now).toISOString();
    }
    // P3b-10: sweep expired rows past the grace window — the number is gone
    // for good (only its masked form survives for display), while the
    // requesterCode stays so ownership history remains verifiable.
    if (row.status === "Expired" && !row.phonePurged && row.contactPhone && row.expiredAt) {
      const expiredMs = new Date(row.expiredAt).getTime();
      if (Number.isFinite(expiredMs) && now - expiredMs > EXPIRED_PHONE_PURGE_GRACE_MS) {
        purgeIds.push(row.id);
        row.contactPhone = maskPhone(row.contactPhone);
        row.phonePurged = true;
      }
    }
  }
  if (expiredIds.length > 0 || purgeIds.length > 0) {
    const { mode, db } = await getDb();
    if (mode === "mongodb" && db) {
      for (const id of expiredIds) {
        await db.collection("emergencies").updateOne(
          { id },
          { $set: { status: "Expired", expiredAt: new Date(now).toISOString() } }
        );
      }
      for (const id of purgeIds) {
        const row = list.find(r => r.id === id);
        const masked = row ? row.contactPhone : null;
        if (masked) {
          await db.collection("emergencies").updateOne(
            { id },
            { $set: { contactPhone: masked, phonePurged: true } }
          );
          await db.collection("contactrequests").updateMany(
            { sosId: id },
            { $set: { requesterPhone: masked } }
          );
        }
      }
    } else {
      // In-memory rows were mutated in place above; mirror the requester-
      // phone scrub onto the contact-request copies too.
      for (const id of purgeIds) {
        const row = list.find(r => r.id === id);
        if (!row) continue;
        memoryContactRequests = memoryContactRequests.map(c =>
          c.sosId === id ? { ...c, requesterPhone: row.contactPhone } : c
        );
      }
    }
  }
  return expiredIds;
}

function publicRows<T extends { isSample?: boolean }>(rows: T[], includeSample?: boolean): T[] {
  if (includeSample || !CONFIG.IS_PROD) return rows;
  return rows.filter((r) => r.isSample !== true);
}

function publicQuery(includeSample?: boolean): Record<string, unknown> {
  if (includeSample || !CONFIG.IS_PROD) return {};
  return { isSample: { $ne: true } };
}

export async function getAcceptedContactRequests(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("contactrequests").find({ status: "accepted", ...publicQuery(opts.includeSample) }).toArray();
  }
  return publicRows(memoryContactRequests.filter(c => c.status === "accepted"), opts.includeSample);
}


// Mongo helpers
let mongoClient: MongoClient | null = null;
let db: Db | null = null;
let isConnected = false;

// Attempt database connection lazy-loaded on request or on startup
export async function getDb(): Promise<{ mode: "mongodb" | "fallback"; db: Db | null }> {
  if (!CONFIG.MONGO_URI) {
    // The reset hook also runs in fallback mode (memory state is trivially
    // empty, but the operator still gets the audit trail of the event).
    await applyAdminTotpResetIfRequested();
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
    await applyAdminTotpResetIfRequested();

    return { mode: "mongodb", db };
  } catch (err) {
    console.error("MongoDB connection failed, falling back to local memory store:", err);
    isConnected = false;
    db = null;
    return { mode: "fallback", db: null };
  }
}

// P3a-8 lockout recovery: setting ADMIN_TOTP_RESET=true for one deploy clears
// every admin's TOTP/recovery state (the founder lost their authenticator),
// audit-logs the event, and the operator removes the flag on the next deploy.
// Runs at most once per process, on first DB touch.
let totpResetApplied = false;
async function applyAdminTotpResetIfRequested(): Promise<void> {
  if (totpResetApplied || process.env.ADMIN_TOTP_RESET !== "true") return;
  totpResetApplied = true;
  try {
    const { mode, db: database } = await getDb();
    if (mode === "mongodb" && database) {
      await database.collection("adminsecurity").deleteMany({});
    }
    memoryAdminSecurity = [];
    console.warn("[admin-totp] ADMIN_TOTP_RESET=true — all admin two-step state cleared");
    await addAuditLog({
      action: "admin_totp_reset",
      actor: "system",
      detail: "ADMIN_TOTP_RESET=true on boot — all admin TOTP secrets, recovery codes and devices cleared",
    });
  } catch (err) {
    console.error("[admin-totp] reset failed:", err);
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

    // Organizations start empty — a real org record only exists once a
    // verified phone applies and an admin approves it. Never fabricated.
    if (!names.includes("organizations")) {
      await database.createCollection("organizations");
      console.log("Created organizations collection in MongoDB");
    }

    // Push subscriptions start empty too — a subscription only exists when
    // a real donor's browser actually subscribed. Never fabricated.
    if (!names.includes("pushSubscriptions")) {
      await database.createCollection("pushSubscriptions");
      console.log("Created pushSubscriptions collection in MongoDB");
    }

    // Admin security records start empty (P3a-8): a TOTP secret only exists
    // once a real admin actually enrolls. Never fabricated.
    if (!names.includes("adminsecurity")) {
      await database.createCollection("adminsecurity");
      console.log("Created adminsecurity collection in MongoDB");
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
    // Requester proof tokens (P0-1): unique per token, TTL after expiry.
    await database.collection("requester_proofs").createIndex({ tokenHash: 1 }, { unique: true });
    await database.collection("requester_proofs").createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
    await database.collection("contactrequests").createIndex({ donorPhone: 1, status: 1 });
    await database.collection("contactrequests").createIndex({ sosId: 1, status: 1 });
    // P2-3: one contact-request row per SOS+donor. The unique index makes a
    // concurrent double-insert fail harmlessly (11000) instead of flooding
    // the donor's inbox with duplicate rows.
    await database.collection("contactrequests").createIndex({ sosId: 1, donorPhone: 1 }, { unique: true });
    await database.collection("auditlog").createIndex({ timestamp: -1 });
    await database.collection("organizations").createIndex({ contactPhone: 1 }, { unique: true });
    await database.collection("organizations").createIndex({ status: 1 });
    await database.collection("pushSubscriptions").createIndex({ phone: 1 }, { unique: true });
    // P2-8: refresh-token registry — jti lookup for rotation/revocation, and
    // a TTL index so expired rows self-destruct in MongoDB.
    await database.collection("refreshtokens").createIndex({ jti: 1 }, { unique: true });
    await database.collection("refreshtokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    // P3a-8: one security record per admin phone.
    await database.collection("adminsecurity").createIndex({ phone: 1 }, { unique: true });
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

export async function getDonors(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("donors").find(publicQuery(opts.includeSample)).toArray();
  }
  return publicRows(memoryDonors, opts.includeSample);
}

export async function getDonorByPhone(phone: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("donors").findOne({ phone });
  }
  return memoryDonors.find(d => d.phone === phone) || null;
}

export async function getDonorById(id: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("donors").findOne({ id });
  }
  return memoryDonors.find(d => d.id === id) || null;
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

// P3b-10 delete-my-data: removes everything tied to a donor's phone —
// profile, inbox history, targeted notifications — but refuses while a
// contact handoff is still in flight (open or accepted). Those rows belong
// to the requester's side of the exchange too; deleting them mid-handoff
// would orphan a real patient's lifeline. The caller tells the donor to
// resolve or wait them out, then retry.
export async function deleteDonorAccount(phone: string): Promise<{ error: string; code: string } | { ok: true }> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const active = await db.collection("contactrequests").findOne({ donorPhone: phone, status: { $in: ["open", "accepted"] } });
    if (active) {
      return { error: "You have a contact request still in progress. Resolve it first (accept or decline), then delete your data.", code: "ACTIVE_CONTACT" };
    }
    await db.collection("donors").deleteOne({ phone });
    await db.collection("contactrequests").deleteMany({ donorPhone: phone });
    await db.collection("notifications").deleteMany({ targetPhone: phone });
    await db.collection("pushSubscriptions").deleteMany({ phone });
    return { ok: true };
  }
  const active = memoryContactRequests.find(c => c.donorPhone === phone && (c.status === "open" || c.status === "accepted"));
  if (active) {
    return { error: "You have a contact request still in progress. Resolve it first (accept or decline), then delete your data.", code: "ACTIVE_CONTACT" };
  }
  memoryDonors = memoryDonors.filter(d => d.phone !== phone);
  memoryContactRequests = memoryContactRequests.filter(c => c.donorPhone !== phone);
  memoryNotifications = memoryNotifications.filter(n => n.targetPhone !== phone);
  memoryPushSubscriptions = memoryPushSubscriptions.filter(s => s.phone !== phone);
  return { ok: true };
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

export async function getHospitals(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("hospitals").find(publicQuery(opts.includeSample)).toArray();
  }
  return publicRows(memoryHospitals, opts.includeSample);
}

export async function getCamps(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("camps").find(publicQuery(opts.includeSample)).toArray();
  }
  return publicRows(memoryCamps, opts.includeSample);
}

// ---------------------------------------------------------------
// Organizations (Phase 3): lightweight NGO/hospital portal. A
// verified phone applies; an admin approves. Approved hospital
// organizations may update their blood bank's stock with timestamps;
// approved NGO/hospital organizations post SOS on behalf of patients
// and can close the requests they posted. One organization per phone —
// a phone identity owns exactly one org record.
// ---------------------------------------------------------------

export async function getOrganizations(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("organizations").find({}).toArray();
  }
  return memoryOrganizations;
}

export async function getOrganizationById(id: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("organizations").findOne({ id });
  }
  return memoryOrganizations.find(o => o.id === id) || null;
}

// Any org record owned by this phone (whatever its status) — used to
// enforce "one org per phone" and to show the applicant their status.
export async function getOrganizationForPhone(phone: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("organizations").findOne({ contactPhone: phone });
  }
  return memoryOrganizations.find(o => o.contactPhone === phone) || null;
}

// Only approved orgs grant privileges (post-on-behalf, stock updates).
export async function getApprovedOrganizationForPhone(phone: string): Promise<any> {
  const org = await getOrganizationForPhone(phone);
  return org && org.status === "approved" ? org : null;
}

export async function addOrganization(org: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const existing = await db.collection("organizations").findOne({ contactPhone: org.contactPhone });
    if (existing) throw new Error("An organization application already exists for this phone number.");
    await db.collection("organizations").insertOne(org);
    return;
  }
  if (memoryOrganizations.some(o => o.contactPhone === org.contactPhone)) {
    throw new Error("An organization application already exists for this phone number.");
  }
  memoryOrganizations.push(org);
}

export async function setOrganizationStatus(id: string, status: "approved" | "rejected", reviewer: string): Promise<any> {
  const patch = { status, reviewedAt: new Date().toISOString(), reviewedBy: reviewer };
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("organizations").findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryOrganizations.findIndex(o => o.id === id);
  if (idx !== -1) {
    Object.assign(memoryOrganizations[idx], patch);
    return memoryOrganizations[idx];
  }
  return null;
}

// Blood-bank stock update (hospital orgs only — enforced by the route).
// Merges only the groups the caller provided, and stamps the review date
// so "stock last reviewed" is a real timestamp, not a made-up number.
export async function updateHospitalStock(hospitalId: string, availability: Record<string, string>): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const hospital = await db.collection("hospitals").findOne({ id: hospitalId });
    if (!hospital) return null;
    const merged = { ...(hospital.bloodAvailability || {}), ...availability };
    const result = await db.collection("hospitals").findOneAndUpdate(
      { id: hospitalId },
      { $set: { bloodAvailability: merged, stockLastUpdated: new Date().toISOString().split("T")[0] } },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryHospitals.findIndex(h => h.id === hospitalId);
  if (idx === -1) return null;
  memoryHospitals[idx].bloodAvailability = {
    ...(memoryHospitals[idx].bloodAvailability || {}),
    ...availability,
  };
  memoryHospitals[idx].stockLastUpdated = new Date().toISOString().split("T")[0];
  return memoryHospitals[idx];
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

export async function getEmergencies(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  let rows: any[];
  if (mode === "mongodb" && db) {
    rows = await db.collection("emergencies").find(publicQuery(opts.includeSample)).sort({ createdAt: -1 }).toArray();
  } else {
    rows = [...memoryEmergencies];
  }
  await expireStale(rows);
  return publicRows(rows, opts.includeSample);
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

  // P3a-6: a phone an admin has blocked cannot raise new requests. Checked
  // first — a blocked spammer must not get the friendlier "duplicate" answer.
  if (await isPhoneBlocked(normalizedRequester)) {
    return {
      error: "This phone number has been blocked from raising requests. If you believe this is a mistake, please contact the hospital directly.",
      code: "PHONE_BLOCKED",
    };
  }

  const allEmergencies = await getEmergencies();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Approved organizations post on behalf of many different patients, so
  // "same phone + same group + still pending" is NOT spam for them (two
  // O+ patients can both be bleeding today). Their cap is higher instead.
  const postedByOrg = Boolean(input.org && input.org.id && input.org.name);

  if (!postedByOrg) {
    // Duplicate detection: same phone + same blood group + still Pending.
    // This is the honest answer to a double-tap or retry — "we found your
    // open request" instead of broadcasting the same SOS twice.
    const duplicate = allEmergencies.find(e =>
      normalizePhone(e.contactPhone || "") === normalizedRequester &&
      e.bloodGroup === (input.bloodGroup || "O-") &&
      e.status === "Pending"
    );
    if (duplicate) return { duplicate: true, existing: duplicate };
  }

  // Per-phone cap: max 3 SOS per phone per 24 hours (the IP-level rate
  // limiter covers bursts; this covers rotating IPs / shared networks).
  // Verified orgs get 10 — a hospital ward may raise several in a day.
  const dailyCap = postedByOrg ? 10 : 3;
  const recentFromThisPhone = allEmergencies.filter(e =>
    normalizePhone(e.contactPhone || "") === normalizedRequester &&
    new Date(e.createdAt).getTime() > dayAgo
  );
  if (recentFromThisPhone.length >= dailyCap) {
    return {
      error: "You have raised several requests in the last 24 hours. For further requests, please call the hospital directly.",
      code: "PHONE_LIMIT",
    };
  }

  const hospitals = await getHospitals();
  const requestCity = resolveCity(input.city);
  const selectedHospital = hospitals.find(h => h.id === input.hospitalId) || hospitals.find(h => h.city === requestCity) || hospitals[0];
  // P2-4: the requester's neighbourhood (when picked) anchors the SOS in
  // real coordinates; otherwise the hospital's location is the anchor.
  const neighbourhood = input.neighbourhood ? resolveNeighbourhood(requestCity, input.neighbourhood) : null;
  const anchor = neighbourhood
    || (selectedHospital && selectedHospital.latitude != null ? selectedHospital : null);
  const donors = await getDonors();
  const effectiveBloodGroup = input.bloodGroup || "O-";
  const eligibleDonorTypes = getEligibleDonorsForPatient(effectiveBloodGroup);
  const potentialMatches = donors.filter(d => eligibleDonorTypes.includes(d.bloodGroup) && d.isAvailable && d.city.toLowerCase() === requestCity.toLowerCase());
  // One-time code proving the requester owns this SOS. Used by the contact-
  // request and reveal endpoints — the only way a requester (who never logs
  // in) can prove they are the same person who raised the SOS.
  const requesterCode = crypto.randomBytes(6).toString("hex");
  // P3a-6: scan the (already sanitized) text for fake/test-looking signals.
  const flagReasons = detectSuspiciousFlags({
    patientName: input.patientName,
    reason: input.reason,
    urgency: input.urgency,
    city: input.city,
    neighbourhood: input.neighbourhood,
  });
  const sos = {
    id: "sos-" + crypto.randomUUID(),
    patientName: input.patientName || "Patient (name not given)",
    bloodGroup: effectiveBloodGroup,
    unitsNeeded: Number(input.unitsNeeded) || 1,
    hospitalId: selectedHospital?.id ?? null,
    hospitalName: selectedHospital?.name ?? null,
    contactPhone: input.contactPhone,
    requiredBy: input.requiredBy || new Date(Date.now() + 86400000).toISOString().split("T")[0],
    reason: input.reason || "Surgical critical emergency",
    urgency: input.urgency || "Immediate (SOS)",
    status: "Pending",
    city: requestCity,
    // P2-4: coarse anchor coordinates for distance-based matching — the
    // consented neighbourhood centroid when given, else the hospital.
    ...(neighbourhood ? { neighbourhood: neighbourhood.name } : {}),
    ...(anchor && anchor.latitude != null ? { latitude: anchor.latitude, longitude: anchor.longitude } : {}),
    createdAt: new Date().toISOString(),
    // P0-5: auto-expiry window. The requester can re-confirm ("still need
    // blood") to extend; without it the request closes itself.
    expiresAt: new Date(Date.now() + sosTtlMs()).toISOString(),
    matchingDonorsCount: potentialMatches.length,
    requesterCode,
    // Organization portal (Phase 3): requests posted on behalf of a patient
    // by an approved org are labelled with the org's identity so donors know
    // a verified organization is vouching for the request.
    ...(postedByOrg ? { orgId: input.org.id, orgName: input.org.name, postedBy: "organization" } : {}),
    // P3a-6: soft keyword flagging. Fake-looking content still posts (a
    // heuristic must never suppress a real emergency), but the SOS carries
    // the signals into the admin review queue. Stripped from public payloads.
    ...(flagReasons.length > 0
      ? { flaggedBySystem: { at: new Date().toISOString(), reasons: flagReasons } }
      : {}),
  };
  await addEmergency(sos);
  await addNotification({
    id: "notif-" + crypto.randomUUID(),
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

// Fulfilled and Cancelled are terminal: the handoff is over, so P3b-10
// scrubs the requester's real number at the moment the status flips. The
// masked form stays for display; requesterCode stays for audit/ownership.
const TERMINAL_SOS_STATUSES = new Set(["Fulfilled", "Cancelled"]);

export async function updateEmergencyStatus(sosId: string, status: "Pending" | "Fulfilled" | "Cancelled" | "Expired"): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const row = await db.collection("emergencies").findOne({ id: sosId });
    const scrub = Boolean(row && TERMINAL_SOS_STATUSES.has(status) && row.contactPhone && !row.phonePurged);
    const masked = scrub ? maskPhone(row!.contactPhone) : null;
    const result = await db.collection("emergencies").findOneAndUpdate(
      { id: sosId },
      {
        $set: {
          status,
          // Real timestamp for the North Star metric (time-to-fulfill) —
          // only set when the SOS actually reaches Fulfilled.
          ...(status === "Fulfilled" ? { fulfilledAt: new Date().toISOString() } : {}),
          ...(scrub && masked ? { contactPhone: masked, phonePurged: true } : {}),
        },
      },
      { returnDocument: "after" }
    );
    if (scrub && masked) {
      await db.collection("contactrequests").updateMany(
        { sosId },
        { $set: { requesterPhone: masked } }
      );
    }
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryEmergencies.findIndex(e => e.id === sosId);
  if (idx !== -1) {
    memoryEmergencies[idx].status = status;
    if (status === "Fulfilled") {
      memoryEmergencies[idx].fulfilledAt = new Date().toISOString();
    }
    if (TERMINAL_SOS_STATUSES.has(status) && memoryEmergencies[idx].contactPhone && !memoryEmergencies[idx].phonePurged) {
      const masked = maskPhone(memoryEmergencies[idx].contactPhone);
      memoryEmergencies[idx].contactPhone = masked;
      memoryEmergencies[idx].phonePurged = true;
      memoryContactRequests = memoryContactRequests.map(c =>
        c.sosId === sosId ? { ...c, requesterPhone: masked } : c
      );
    }
    return memoryEmergencies[idx];
  }
  return null;
}

// P0-5 "still need blood?" re-confirm: the requester (or an admin) revives
// an expired request or extends a still-pending one for another full
// window. Fulfilled/Cancelled are terminal — a re-confirm can never reopen
// them, and the caller enforces ownership via the requester code.
export async function extendEmergency(sosId: string): Promise<{ error: string } | { sos: any }> {
  const { mode, db } = await getDb();
  const expiresAt = new Date(Date.now() + sosTtlMs()).toISOString();
  if (mode === "mongodb" && db) {
    const row = await db.collection("emergencies").findOne({ id: sosId });
    if (!row) return { error: "Emergency request not found" };
    if (row.status !== "Pending" && row.status !== "Expired") {
      return { error: `This request was already ${row.status} and can't be re-opened.` };
    }
    // P3b-10: a purged request has no contact phone left — reopening it
    // would produce a "live" SOS no donor can actually coordinate with.
    if (row.phonePurged) {
      return { error: "This request's contact details were removed after it closed. Please raise a new request instead." };
    }
    const result = await db.collection("emergencies").findOneAndUpdate(
      { id: sosId },
      { $set: { status: "Pending", expiresAt } },
      { returnDocument: "after" }
    );
    const sos = result && (result as any).value ? (result as any).value : result;
    return { sos };
  }
  const idx = memoryEmergencies.findIndex(e => e.id === sosId);
  if (idx === -1) return { error: "Emergency request not found" };
  const row = memoryEmergencies[idx];
  if (row.status !== "Pending" && row.status !== "Expired") {
    return { error: `This request was already ${row.status} and can't be re-opened.` };
  }
  if (row.phonePurged) {
    return { error: "This request's contact details were removed after it closed. Please raise a new request instead." };
  }
  row.status = "Pending";
  row.expiresAt = expiresAt;
  return { sos: row };
}

export async function getNotifications(opts: { includeSample?: boolean } = {}): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    // The public feed excludes donor-targeted alerts — those carry a
    // targetPhone and belong only to that donor's private /mine feed.
    return await db
      .collection("notifications")
      .find({ targetPhone: { $exists: false }, ...publicQuery(opts.includeSample) })
      .sort({ timestamp: -1 })
      .toArray();
  }
  return publicRows(memoryNotifications.filter(n => !n.targetPhone), opts.includeSample);
}

export async function addNotification(notification: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("notifications").insertOne(notification);
    return;
  }
  memoryNotifications.unshift(notification);
}

// Targeted alert for a single donor (matched-SOS notification). Stored in
// the same collection with a targetPhone so the public feed can filter it
// out; the donor's own /mine feed returns only rows with their phone.
export async function addTargetedNotification(notification: any): Promise<void> {
  await addNotification(notification);
}

export async function getNotificationsForPhone(phone: string): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("notifications").find({ targetPhone: phone }).sort({ timestamp: -1 }).toArray();
  }
  return memoryNotifications.filter(n => n.targetPhone === phone);
}

export async function markNotificationsReadForPhone(phone: string): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("notifications").updateMany({ targetPhone: phone }, { $set: { read: true } });
    return;
  }
  memoryNotifications = memoryNotifications.map(n => (n.targetPhone === phone ? { ...n, read: true } : n));
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
// Donor notification preferences (quiet hours, channel opt-ins).
// Stored on the donor record; absent means the safe defaults.
// ---------------------------------------------------------------

export async function updateDonorNotifyPrefs(phone: string, notifyPrefs: any): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("donors").findOneAndUpdate(
      { phone },
      { $set: { notifyPrefs } },
      { returnDocument: "after" }
    );
    return result && (result as any).value ? (result as any).value : result;
  }
  const idx = memoryDonors.findIndex(d => d.phone === phone);
  if (idx !== -1) {
    memoryDonors[idx].notifyPrefs = notifyPrefs;
    return memoryDonors[idx];
  }
  return null;
}

// ---------------------------------------------------------------
// Web push subscriptions (one per donor phone; last subscribe wins).
// ---------------------------------------------------------------

export async function savePushSubscription(phone: string, subscription: any): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("pushSubscriptions").updateOne(
      { phone },
      { $set: { phone, endpoint: subscription.endpoint, keys: subscription.keys, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return;
  }
  const idx = memoryPushSubscriptions.findIndex(s => s.phone === phone);
  const record = { phone, endpoint: subscription.endpoint, keys: subscription.keys, updatedAt: new Date().toISOString() };
  if (idx !== -1) memoryPushSubscriptions[idx] = record;
  else memoryPushSubscriptions.push(record);
}

export async function getPushSubscriptionForPhone(phone: string): Promise<any> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("pushSubscriptions").findOne({ phone });
  }
  return memoryPushSubscriptions.find(s => s.phone === phone) || null;
}

export async function removePushSubscription(phone: string): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("pushSubscriptions").deleteOne({ phone });
    return;
  }
  memoryPushSubscriptions = memoryPushSubscriptions.filter(s => s.phone !== phone);
}

// ---------------------------------------------------------------
// Contact-reveal flow (privacy core): requester raises SOS → sends
// contact request → matching donors get inbox items → donor accepts →
// both parties' real numbers are revealed to each other, with an
// audit trail. Nobody's full phone number is public anywhere.
// ---------------------------------------------------------------

export async function getEmergencyById(sosId: string, opts: { includeSample?: boolean } = {}): Promise<any> {
  const { mode, db } = await getDb();
  let row: any = null;
  if (mode === "mongodb" && db) {
    row = await db.collection("emergencies").findOne({ id: sosId });
  } else {
    row = memoryEmergencies.find(e => e.id === sosId) || null;
  }
  if (!row) return null;
  // Single-row lazy expiry (P0-5): a pending request past its window is
  // flipped before it can drive any further flow.
  if (isStalePending(row, Date.now())) {
    row.status = "Expired";
    row.expiredAt = new Date().toISOString();
    if (mode === "mongodb" && db) {
      await db.collection("emergencies").updateOne({ id: sosId }, { $set: { status: "Expired", expiredAt: row.expiredAt } });
    }
  }
  return publicRows([row], opts.includeSample)[0] || null;
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

// Moderation (Phase 3 + P3a-6): an admin reviewed a queue entry and decided
// it is legitimate — visitor reports AND system auto-flags are cleared so it
// drops out of the review queue.
export async function clearModerationSignals(sosId: string): Promise<{ ok: boolean; found: boolean }> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("emergencies").updateOne(
      { id: sosId },
      { $set: { reports: [], flaggedBySystem: null } }
    );
    return { ok: result.matchedCount > 0, found: result.matchedCount > 0 };
  }
  const sos = memoryEmergencies.find(e => e.id === sosId);
  if (!sos) return { ok: false, found: false };
  sos.reports = [];
  delete sos.flaggedBySystem;
  return { ok: true, found: true };
}

// P3a-6 blocked-phone list. Blocked phones cannot raise new SOS requests;
// the block is a human (admin) decision, not a heuristic. Unblocking restores
// the ability to post, but does not restore removed requests.
export async function isPhoneBlocked(phone: string): Promise<boolean> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const found = await db.collection("blockedPhones").findOne({ phone });
    return Boolean(found);
  }
  return memoryBlockedPhones.some(b => b.phone === phone);
}

export async function getBlockedPhones(): Promise<any[]> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("blockedPhones").find().sort({ at: -1 }).toArray();
  }
  return [...memoryBlockedPhones];
}

export async function blockPhone(phone: string, actor: string, reason: string): Promise<{ entry: any; removedSosCount: number }> {
  const normalized = normalizePhone(phone);
  const entry = { phone: normalized, at: new Date().toISOString(), actor, reason };
  const { mode, db } = await getDb();

  if (mode === "mongodb" && db) {
    // Idempotent upsert: re-blocking refreshes the reason/timestamp.
    await db.collection("blockedPhones").updateOne(
      { phone: normalized },
      { $set: entry },
      { upsert: true }
    );
    // Purge everything this phone ever posted so nothing fake stays public
    // and nothing fake can later be marked "Fulfilled" (which would pollute
    // the Lives Saved metric).
    const removed = await db.collection("emergencies").deleteMany({ contactPhone: normalized });
    return { entry, removedSosCount: removed.deletedCount };
  }

  if (!memoryBlockedPhones.some(b => b.phone === normalized)) {
    memoryBlockedPhones.unshift(entry);
  } else {
    const idx = memoryBlockedPhones.findIndex(b => b.phone === normalized);
    memoryBlockedPhones[idx] = entry;
  }
  const before = memoryEmergencies.length;
  memoryEmergencies = memoryEmergencies.filter(e => normalizePhone(e.contactPhone || "") !== normalized);
  return { entry, removedSosCount: before - memoryEmergencies.length };
}

export async function unblockPhone(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    const result = await db.collection("blockedPhones").deleteOne({ phone: normalized });
    return result.deletedCount > 0;
  }
  const idx = memoryBlockedPhones.findIndex(b => b.phone === normalized);
  if (idx === -1) return false;
  memoryBlockedPhones.splice(idx, 1);
  return true;
}

// ---------------------------------------------------------------------------
// P3a-8 admin two-step security records. One record per admin phone:
//  - totpSecret / totpEnabled — the active authenticator-app secret
//  - pendingTotpSecret / pendingRecoveryCodes — enrollment in progress
//    (recovery codes stay PLAIN only until enrollment is confirmed; after
//    that only their SHA-256 hashes exist, and they're shown exactly once)
//  - knownDevices — device-id cookies we've seen sign in (max 10)
// The secret itself never leaves the backend except at the instant of
// enrollment, when the admin scans it. API responses never return it.
// ---------------------------------------------------------------------------

export async function getAdminSecurity(phone: string): Promise<any> {
  const normalized = normalizePhone(phone);
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return await db.collection("adminsecurity").findOne({ phone: normalized });
  }
  return memoryAdminSecurity.find(s => s.phone === normalized) || null;
}

export async function setAdminSecurity(record: any): Promise<void> {
  record.phone = normalizePhone(record.phone);
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("adminsecurity").updateOne(
      { phone: record.phone },
      { $set: record },
      { upsert: true }
    );
    return;
  }
  const idx = memoryAdminSecurity.findIndex(s => s.phone === record.phone);
  if (idx >= 0) memoryAdminSecurity[idx] = record;
  else memoryAdminSecurity.push(record);
}

/** Records (or refreshes) a device-id cookie for the admin's phone.
 * Returns isNew=true the first time this device signs in — the caller turns
 * that into a new-device alert. */
export async function trackAdminDevice(
  phone: string,
  deviceId: string,
  label: string
): Promise<{ isNew: boolean }> {
  const sec = await getAdminSecurity(phone);
  const devices = Array.isArray(sec?.knownDevices) ? [...sec.knownDevices] : [];
  const now = new Date().toISOString();
  const existing = devices.find((d: any) => d.id === deviceId);
  let isNew = false;
  if (existing) {
    existing.lastSeen = now;
    if (label) existing.label = label;
  } else {
    isNew = true;
    devices.push({ id: deviceId, label, firstSeen: now, lastSeen: now });
    // Keep the list bounded — the oldest device drops off (and would alert
    // again if it ever signs back in, which is the honest behaviour).
    while (devices.length > 10) devices.shift();
  }
  await setAdminSecurity({
    ...(sec || { phone }),
    phone,
    knownDevices: devices,
  });
  return { isNew };
}

export async function forgetAdminDevice(phone: string, deviceId: string): Promise<boolean> {
  const sec = await getAdminSecurity(phone);
  if (!sec || !Array.isArray(sec.knownDevices)) return false;
  const before = sec.knownDevices.length;
  const devices = sec.knownDevices.filter((d: any) => d.id !== deviceId);
  if (devices.length === before) return false;
  await setAdminSecurity({ ...sec, knownDevices: devices });
  return true;
}

/** Consumes one recovery code (by hash). Caller verifies the match first. */
export async function consumeAdminRecoveryCode(phone: string, hash: string): Promise<void> {
  const sec = await getAdminSecurity(phone);
  if (!sec) return;
  const hashes = (Array.isArray(sec.recoveryCodeHashes) ? sec.recoveryCodeHashes : [])
    .filter((h: string) => h !== hash);
  await setAdminSecurity({ ...sec, recoveryCodeHashes: hashes });
}

// P2-3 re-send policy: repeat contact-request calls must not flood donor
// inboxes. One open row per SOS+donor; a re-send needs a minimum gap and a
// hard cap of MAX_CONTACT_RETRIES notification rounds per donor per SOS.
const CONTACT_REQUERY_GAP_MS = 10 * 60 * 1000; // 10 minutes between re-sends
const MAX_CONTACT_RETRIES = 3; // initial notify + at most 2 re-sends

// Creates one open contact request per matching donor for the given SOS.
// Idempotent per SOS+donor: repeat calls only re-send to donors whose open
// request passed the gap and cap rules. Returns the list of requests that
// were actually (re-)notified this round.
export async function createContactRequestsForSos(sos: any): Promise<any[]> {
  const donors = await getDonors();
  const eligibleDonorTypes = getEligibleDonorsForPatient(sos.bloodGroup);
  const inCity = donors.filter(d =>
    eligibleDonorTypes.includes(d.bloodGroup) &&
    d.isAvailable &&
    d.city.toLowerCase() === (sos.city || "").toLowerCase()
  );
  // P2-4: notify nearest first — rank by real distance from the SOS anchor
  // (neighbourhood centroid, or hospital coords when none was given).
  // Donors without coordinates sort last (they can only be older rows).
  const matches = inCity.sort((a, b) => {
    const da = haversineKm(sos.latitude, sos.longitude, a.latitude, a.longitude);
    const db = haversineKm(sos.latitude, sos.longitude, b.latitude, b.longitude);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  const { mode, db } = await getDb();
  const now = new Date().toISOString();
  const notified: any[] = [];

  for (const d of matches) {
    let existing: any = null;
    if (mode === "mongodb" && db) {
      existing = await db.collection("contactrequests").findOne({ sosId: sos.id, donorPhone: d.phone });
    } else {
      existing = memoryContactRequests.find(c => c.sosId === sos.id && c.donorPhone === d.phone) || null;
    }

    if (existing) {
      // Re-send rules: never re-open a closed request (a declined donor is
      // never re-pestered), respect the minimum gap, and never exceed the
      // per-donor cap.
      const sendCount = existing.sendCount ?? 1;
      const lastSentAt = existing.lastSentAt || existing.createdAt;
      if (existing.status !== "open") continue;
      if (sendCount >= MAX_CONTACT_RETRIES) continue;
      const lastSentMs = new Date(lastSentAt).getTime();
      if (!Number.isFinite(lastSentMs) || Date.now() - lastSentMs < CONTACT_REQUERY_GAP_MS) continue;

      if (mode === "mongodb" && db) {
        await db.collection("contactrequests").updateOne(
          { id: existing.id },
          { $set: { lastSentAt: now, notifiedAt: now }, $inc: { sendCount: 1 } }
        );
      } else {
        const idx = memoryContactRequests.findIndex(c => c.id === existing.id);
        memoryContactRequests[idx] = { ...memoryContactRequests[idx], lastSentAt: now, notifiedAt: now, sendCount: (memoryContactRequests[idx].sendCount ?? 1) + 1 };
      }
      notified.push({ ...existing, lastSentAt: now, sendCount: sendCount + 1 });
      continue;
    }

    // First notification for this donor.
    const row = {
      id: "cr-" + crypto.randomUUID(),
      sosId: sos.id,
      requesterPhone: sos.contactPhone,
      donorPhone: d.phone,
      status: "open",
      sendCount: 1,
      lastSentAt: now,
      createdAt: now,
    };
    if (mode === "mongodb" && db) {
      try {
        await db.collection("contactrequests").insertOne(row);
      } catch (err: any) {
        // 11000 = duplicate key on the unique (sosId, donorPhone) index —
        // a concurrent call created this row first. The donor is already
        // notified; nothing to do.
        if (err && err.code === 11000) continue;
        throw err;
      }
    } else {
      if (!memoryContactRequests.some(c => c.sosId === sos.id && c.donorPhone === d.phone)) {
        memoryContactRequests.push(row);
      }
    }
    notified.push(row);
  }
  return notified;
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
  const acceptedAt = new Date().toISOString();
  let request: any = null;
  if (mode === "mongodb" && db) {
    // Atomic conditional accept: the { status: "open" } filter makes the
    // check-and-set ONE operation, so two donors accepting concurrently
    // cannot both win (the loser matches nothing).
    const result = await db.collection("contactrequests").findOneAndUpdate(
      { id, donorPhone, status: "open" },
      { $set: { status: "accepted", acceptedAt } },
      { returnDocument: "after" }
    );
    const value = result && (result as any).value ? (result as any).value : result;
    if (value) {
      request = value;
      await db.collection("contactrequests").updateMany(
        { sosId: value.sosId, id: { $ne: id }, status: "open" },
        { $set: { status: "superseded" } }
      );
    }
  } else {
    // In-memory path: the check-and-write block has no await inside, so it
    // is atomic within the event loop (equivalent to the conditional
    // findOneAndUpdate above).
    const idx = memoryContactRequests.findIndex(c => c.id === id);
    if (idx !== -1 && memoryContactRequests[idx].donorPhone === donorPhone && memoryContactRequests[idx].status === "open") {
      memoryContactRequests[idx] = { ...memoryContactRequests[idx], status: "accepted", acceptedAt };
      request = memoryContactRequests[idx];
      memoryContactRequests = memoryContactRequests.map(c =>
        c.sosId === request.sosId && c.id !== id && c.status === "open"
          ? { ...c, status: "superseded" }
          : c
      );
    }
  }
  if (!request) {
    const existing = await getContactRequestById(id);
    if (!existing) return { error: "Contact request not found." };
    if (existing.donorPhone !== donorPhone) return { error: "This request is not for your account." };
    return { error: existing.status === "accepted" ? "You already accepted this request." : "This request is no longer open (someone may have responded first)." };
  }

  await addAuditLog({
    action: "contact_request_accepted",
    actor: donorPhone,
    target: request.requesterPhone,
    sosId: request.sosId,
    detail: "Donor accepted — both parties' phone numbers revealed to each other",
  });

  const updated = (await getContactRequestById(id)) || request;
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
  const record = { id: "aud-" + crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry };
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("auditlog").insertOne(record);
    return;
  }
  memoryAuditLog.unshift(record);
}

export async function getAuditLogs(): Promise<any[]> {
  const { mode, db } = await getDb();
  // P3b-10: audit entries older than the retention ceiling are deleted on
  // read (lazy pruning — the admin dashboard read is the sweep). The policy
  // page cites this limit honestly.
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (mode === "mongodb" && db) {
    await db.collection("auditlog").deleteMany({ timestamp: { $lt: cutoff.toISOString() } });
    return await db.collection("auditlog").find({}).sort({ timestamp: -1 }).limit(500).toArray();
  }
  memoryAuditLog = memoryAuditLog.filter(a => new Date(a.timestamp).getTime() > cutoff.getTime());
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
  // P3b-10: visitor chat history expires after 90 days — pruned lazily on
  // each write. Old sessions shrink on their own, no cron needed.
  const cutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (mode === "mongodb" && db) {
    await db.collection("chats").deleteMany({ timestamp: { $lt: cutoff } });
    await db.collection("chats").insertOne({ sessionId: sid, message, timestamp: new Date() });
    return;
  }
  memoryChats = memoryChats.filter(c => c.timestamp > cutoff);
  memoryChats.push({ sessionId: sid, message, timestamp: new Date() });
}
