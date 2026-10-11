/**
 * ROLA challenges — single-use random nonces the client signs with their
 * wallet to prove key ownership of a claimed Radix account.
 *
 * Lifecycle:
 *   1. Client requests a challenge → `issue()`
 *   2. Client signs via Radix Wallet (off-band), proof comes back with
 *      the original challenge embedded.
 *   3. Client POSTs proof → server calls `consume(challenge)` which
 *      atomically verifies the challenge is valid AND marks it used.
 *   4. Unused challenges expire after CHALLENGE_TTL_SEC and are pruned by
 *      `purgeExpired()`, which auth/purge.ts runs at boot and every 10 minutes.
 */

import { randomBytes } from "crypto";
import { getDb } from "../db/connection";

export const CHALLENGE_TTL_SEC = 5 * 60; // 5 minutes
const CHALLENGE_BYTES = 32; // 256 bits of entropy

export interface IssuedChallenge {
  challenge: string; // hex, lower-case, 64 chars
  expiresAt: number; // unix seconds
}

/**
 * Generate a fresh single-use challenge and persist it.
 */
export function issue(): IssuedChallenge {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const challenge = randomBytes(CHALLENGE_BYTES).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_SEC;

  db.prepare(
    "INSERT INTO auth_challenges (challenge, created_at, expires_at) VALUES (?, ?, ?)"
  ).run(challenge, now, expiresAt);

  return { challenge, expiresAt };
}

/**
 * Atomically mark a challenge as consumed iff it's still valid (exists,
 * unexpired, not previously consumed). Returns true on success, false
 * otherwise. Safe against replay and concurrent consume attempts.
 */
export function consume(challenge: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const result = db
    .prepare(
      `UPDATE auth_challenges
         SET consumed_at = ?
       WHERE challenge = ?
         AND consumed_at IS NULL
         AND expires_at >= ?`
    )
    .run(now, challenge, now);

  return result.changes === 1;
}

/**
 * Remove expired + long-consumed rows. Call periodically; cheap.
 */
export function purgeExpired(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  // Keep consumed rows briefly for audit, but drop once way past expiry.
  const cutoff = now - 24 * 60 * 60;
  const result = db
    .prepare(
      `DELETE FROM auth_challenges
         WHERE expires_at < ?
            OR (consumed_at IS NOT NULL AND consumed_at < ?)`
    )
    .run(now, cutoff);
  return result.changes;
}
