import crypto from "crypto";
import { CONFIG } from "../config/config";
import { getDb } from "./dbService";

// P2-8: server-side refresh-token registry. Every refresh token carries a
// jti (JWT ID) claim; the token is only honoured while its row exists and is
// unrotated. A successful refresh consumes the old row atomically and issues
// a new one (rotation). Presenting an already-rotated token is a replay —
// the signature of a stolen token — so the whole session family for that
// phone is revoked. A short grace window absorbs benign double-refresh races
// (e.g. two browser tabs refreshing at once), which would otherwise look
// exactly like a replay and log the user out.

const REPLAY_GRACE_MS = 30 * 1000;

export interface RefreshTokenRow {
  jti: string;
  sub: string;
  expiresAt: Date;
  rotated: boolean;
  rotatedAt?: Date;
  createdAt: Date;
}

const memoryRows: RefreshTokenRow[] = [];

function newJti(): string {
  return crypto.randomUUID();
}

async function cleanupExpired(now: Date): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("refreshtokens").deleteMany({ expiresAt: { $lte: now } });
    return;
  }
  for (let i = memoryRows.length - 1; i >= 0; i--) {
    if (memoryRows[i].expiresAt <= now) memoryRows.splice(i, 1);
  }
}

// Registers a fresh refresh token for `sub` and returns its row. The caller
// signs the JWT with row.jti as the jti claim.
export async function issueRefreshToken(sub: string, now: Date = new Date()): Promise<RefreshTokenRow> {
  await cleanupExpired(now);
  const row: RefreshTokenRow = {
    jti: newJti(),
    sub,
    expiresAt: new Date(now.getTime() + CONFIG.REFRESH_TOKEN_TTL_SECONDS * 1000),
    rotated: false,
    createdAt: now,
  };
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("refreshtokens").insertOne(row);
  } else {
    memoryRows.push(row);
  }
  return row;
}

export type RotateResult = { ok: true } | { ok: false; reason: "reused" };

// Consumes oldJti atomically (only when unrotated and unexpired). On replay
// outside the grace window, revokes every active refresh token for the phone.
export async function rotateRefreshToken(
  oldJti: string,
  sub: string,
  now: Date = new Date()
): Promise<RotateResult> {
  await cleanupExpired(now);
  const { mode, db } = await getDb();

  if (mode === "mongodb" && db) {
    const consumed = await db.collection("refreshtokens").findOneAndUpdate(
      { jti: oldJti, rotated: false, expiresAt: { $gt: now } },
      { $set: { rotated: true, rotatedAt: now } },
      { returnDocument: "after" }
    );
    const row = consumed && (consumed as any).value ? (consumed as any).value : consumed;
    if (row) return { ok: true };

    const existing = await db.collection("refreshtokens").findOne({ jti: oldJti });
    if (existing && existing.rotated && existing.rotatedAt) {
      const ageMs = now.getTime() - new Date(existing.rotatedAt).getTime();
      if (ageMs <= REPLAY_GRACE_MS) return { ok: true };
    }
    // Replay beyond the grace window, or an unknown token: kill the family.
    await db.collection("refreshtokens").deleteMany({ sub });
    return { ok: false, reason: "reused" };
  }

  // In-memory path: the check-and-write block below contains no await, so it
  // is atomic within the event loop (same guarantee as the Mongo conditional).
  const idx = memoryRows.findIndex((r) => r.jti === oldJti && !r.rotated && r.expiresAt > now);
  if (idx !== -1) {
    memoryRows[idx].rotated = true;
    memoryRows[idx].rotatedAt = now;
    return { ok: true };
  }
  const existing = memoryRows.find((r) => r.jti === oldJti);
  if (existing && existing.rotated && existing.rotatedAt) {
    const ageMs = now.getTime() - existing.rotatedAt.getTime();
    if (ageMs <= REPLAY_GRACE_MS) return { ok: true };
  }
  for (let i = memoryRows.length - 1; i >= 0; i--) {
    if (memoryRows[i].sub === sub) memoryRows.splice(i, 1);
  }
  return { ok: false, reason: "reused" };
}

// Logout: revokes exactly the presented token. Other devices stay logged in.
export async function revokeRefreshTokenByJti(jti: string): Promise<void> {
  const { mode, db } = await getDb();
  if (mode === "mongodb" && db) {
    await db.collection("refreshtokens").deleteOne({ jti });
    return;
  }
  const idx = memoryRows.findIndex((r) => r.jti === jti);
  if (idx !== -1) memoryRows.splice(idx, 1);
}
