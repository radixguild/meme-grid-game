/**
 * Per-IP metering of the free starting balance for `account_…` addresses.
 *
 * The guest path is metered at issuance (auth/guest-id.ts). This is the other
 * door: `GET /api/game/:address` funds any unseen address, and a Radix account
 * address is self-asserted — `validateAddress` checks the checksum but nobody
 * proves ownership while `ROLA_AUTH_MODE` is `legacy`. Without this, an attacker
 * generating keypairs offline mints funded accounts at the rate limiter's
 * ceiling. See docs/PROJECT-STATE.md item 14.
 *
 * Deliberately meters the CREDIT, not player-row creation. Other routes
 * (`daily.ts`, `token.ts`) also call `getOrCreatePlayer`, but only `game.ts`
 * credits the balance — gating the money is what matters, and gating row
 * creation instead would break those routes for legitimate existing players.
 *
 * Reuses `hashIp` from guest-id.ts, so IPv6 buckets by /64 here too.
 */

import { getDb } from "../connection";

/** Same rolling window as the guest quota, for one mental model rather than two. */
export const GRANT_QUOTA_WINDOW_SEC = 24 * 60 * 60;

const DEFAULT_ACCOUNT_QUOTA_PER_IP = 10;

/**
 * How many `account_…` addresses one IP may have funded per rolling day.
 *
 * Higher than the guest default (5) on purpose: obtaining a Radix wallet is
 * itself a barrier, so a burst from one IP is more likely to be a real household
 * or office than a farm. It is still a hard bound — the point is that the
 * previous bound was *nothing at all*.
 */
export function accountQuotaPerIp(): number {
  const raw = process.env.ACCOUNT_MAX_NEW_PER_IP_PER_DAY;
  if (!raw) return DEFAULT_ACCOUNT_QUOTA_PER_IP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    console.warn(
      `[starting-balance] ACCOUNT_MAX_NEW_PER_IP_PER_DAY=${raw} is not an integer in 1..1000 — ` +
        `using ${DEFAULT_ACCOUNT_QUOTA_PER_IP}.`
    );
    return DEFAULT_ACCOUNT_QUOTA_PER_IP;
  }
  return n;
}

export interface GrantQuotaState {
  used: number;
  quota: number;
  remaining: number;
}

export function accountQuotaFor(ipHash: string): GrantQuotaState {
  const since = Math.floor(Date.now() / 1000) - GRANT_QUOTA_WINDOW_SEC;
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM starting_balance_grants WHERE ip_hash = ? AND created_at > ?"
    )
    .get(ipHash, since) as { n: number };
  const quota = accountQuotaPerIp();
  return { used: row.n, quota, remaining: Math.max(0, quota - row.n) };
}

/**
 * Record that `address` was funded from `ipHash`.
 *
 * INSERT OR IGNORE rather than INSERT: the address is the primary key, so a
 * re-grant attempt for an address already recorded is a no-op instead of a 500.
 * `creditStartingBalanceOnce` is the real idempotency gate; this keeps the two
 * from disagreeing.
 */
export function recordStartingBalanceGrant(address: string, ipHash: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO starting_balance_grants (radix_address, ip_hash) VALUES (?, ?)"
    )
    .run(address, ipHash);
}

/** Where are new funded accounts coming from? Mirrors getCreditTotalsBySource()'s purpose. */
export function getGrantCountsByBucket(limit = 20): { ip_hash: string; grants: number }[] {
  const since = Math.floor(Date.now() / 1000) - GRANT_QUOTA_WINDOW_SEC;
  return getDb()
    .prepare(
      `SELECT ip_hash, COUNT(*) AS grants FROM starting_balance_grants
        WHERE created_at > ? AND ip_hash <> 'legacy'
        GROUP BY ip_hash ORDER BY grants DESC LIMIT ?`
    )
    .all(since, limit) as { ip_hash: string; grants: number }[];
}
