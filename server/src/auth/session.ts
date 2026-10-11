/**
 * Auth sessions — opaque bearer tokens bound to a verified radix_address.
 *
 * We deliberately don't use JWTs here: the DB is already authoritative
 * for per-user state, and opaque tokens let us revoke them instantly
 * (by deleting the row) without cache/blacklist complexity.
 *
 * Token format: 256 bits of crypto-random entropy, hex-encoded. Stored
 * directly in `auth_sessions.token` — SQLite's unique index makes
 * lookup O(log n). If the attack surface grows (or the DB moves off
 * this server) we'd hash tokens at rest.
 */

import { randomBytes } from "crypto";
import { getDb } from "../db/connection";

export const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export interface Session {
  token: string;
  radix_address: string;
  created_at: number;
  expires_at: number;
  origin: string | null;
}

export interface IssueInput {
  radix_address: string;
  userAgent?: string | null;
  origin?: string | null;
}

export function issueSession(input: IssueInput): Session {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_TTL_SEC;

  db.prepare(
    `INSERT INTO auth_sessions
       (token, radix_address, created_at, expires_at, last_seen_at, user_agent, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    token,
    input.radix_address,
    now,
    expiresAt,
    now,
    input.userAgent ?? null,
    input.origin ?? null
  );

  return {
    token,
    radix_address: input.radix_address,
    created_at: now,
    expires_at: expiresAt,
    origin: input.origin ?? null,
  };
}

/**
 * Look up a session by token. Returns null if the token doesn't exist,
 * has expired, or has been revoked. Touches `last_seen_at` on hit.
 */
export function lookupSession(token: string): Session | null {
  if (!token || typeof token !== "string") return null;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare(
      `SELECT token, radix_address, created_at, expires_at, origin
         FROM auth_sessions
        WHERE token = ?
          AND revoked_at IS NULL
          AND expires_at >= ?`
    )
    .get(token, now) as Session | undefined;

  if (!row) return null;

  // Best-effort touch. Don't throw if this fails — session is still valid.
  try {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token = ?").run(now, token);
  } catch {
    /* ignore */
  }

  return row;
}

export function revokeSession(token: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = db
    .prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL")
    .run(now, token);
  return res.changes === 1;
}

export function revokeAllForAddress(radix_address: string): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = db
    .prepare(
      "UPDATE auth_sessions SET revoked_at = ? WHERE radix_address = ? AND revoked_at IS NULL"
    )
    .run(now, radix_address);
  return res.changes;
}

export function purgeExpired(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 24 * 60 * 60; // keep expired rows 1 day for audit
  const res = db
    .prepare(
      "DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)"
    )
    .run(now, cutoff);
  return res.changes;
}
