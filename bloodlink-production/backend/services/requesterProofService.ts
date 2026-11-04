import crypto from "crypto";
import { getDb } from "./dbService";

// Requester proof tokens (P0-1, roadmap blocker 1). An anonymous requester
// proves they own a real phone by completing the same OTP challenge as
// login. A successful verify mints a crypto-random proof token bound to
// that phone, valid for 15 minutes. POST /api/emergencies requires a
// matching proof, so the board can no longer be spammed by anyone without
// a working phone. The token may be used for several posts within its
// lifetime (a family raising two SOS in ten minutes re-verifies once) —
// the per-SOS abuse controls (duplicate detection, 3/day cap) still apply
// on top. At rest the store holds only hashes: the raw token exists in
// memory for the instant it is generated and is handed to the client once.

const DEFAULT_PROOF_TTL_MS = 15 * 60 * 1000;

// Read at call time (like COUNTRY_CODE) so tests can shorten the TTL by
// setting REQUESTER_PROOF_TTL_MS without touching CONFIG.
function proofTtlMs(): number {
  const v = Number(process.env.REQUESTER_PROOF_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PROOF_TTL_MS;
}

interface ProofRecord {
  tokenHash: string;
  phoneHash: string;
  expiresAt: number;
  // Date twin of expiresAt, used by the Mongo TTL index (TTL needs a Date).
  expiresAtDate: Date;
  createdAt: number;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(`proof-token:${token}`).digest("hex");
}

function hashPhone(phone: string): string {
  return crypto.createHash("sha256").update(`proof-phone:${phone}`).digest("hex");
}

// In-memory fallback store (dev / no Mongo).
const memoryProofs = new Map<string, ProofRecord>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, rec] of memoryProofs) {
    if (now > rec.expiresAt) memoryProofs.delete(key);
  }
}

async function putRecord(record: ProofRecord): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("requester_proofs").updateOne(
      { tokenHash: record.tokenHash },
      { $set: record },
      { upsert: true }
    );
    return;
  }
  memoryProofs.set(record.tokenHash, record);
}

async function getRecord(tokenHash: string): Promise<ProofRecord | null> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    return (await db.collection("requester_proofs").findOne({ tokenHash })) as unknown as ProofRecord | null;
  }
  return memoryProofs.get(tokenHash) || null;
}

async function deleteRecord(tokenHash: string): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("requester_proofs").deleteOne({ tokenHash });
    return;
  }
  memoryProofs.delete(tokenHash);
}

export interface ProofIssueResult {
  token: string;
  expiresAt: number;
  expiresInSeconds: number;
}

/** Mints a proof token for an OTP-verified phone. */
export async function issueProofToken(phone: string): Promise<ProofIssueResult> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + proofTtlMs();
  await putRecord({
    tokenHash: hashToken(token),
    phoneHash: hashPhone(phone),
    expiresAt,
    expiresAtDate: new Date(expiresAt),
    createdAt: Date.now(),
  });
  pruneMemory();
  return {
    token,
    expiresAt,
    expiresInSeconds: Math.max(1, Math.round((expiresAt - Date.now()) / 1000)),
  };
}

export type ProofCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a proof token against the phone on the SOS. Never returns the
 * token itself. Tokens are multi-use within their lifetime, so a failed
 * check only deletes the record when it has expired.
 */
export async function checkProofToken(token: string, phone: string): Promise<ProofCheckResult> {
  if (!token) {
    return {
      ok: false,
      error: "Verify your phone number first — a 6-digit code proves this request is real.",
    };
  }
  const rec = await getRecord(hashToken(token));
  if (!rec) {
    return {
      ok: false,
      error: "Your phone verification is missing or invalid. Verify your number and try again.",
    };
  }
  if (Date.now() > rec.expiresAt) {
    await deleteRecord(hashToken(token));
    return {
      ok: false,
      error: "Your phone verification expired (15 minutes). Verify your number again.",
    };
  }
  if (rec.phoneHash !== hashPhone(phone)) {
    return {
      ok: false,
      error: "Phone verification doesn't match the number on this request.",
    };
  }
  return { ok: true };
}
