/**
 * Guest identities — opaque, server-issued, HMAC-signed.
 *
 * A guest is someone playing with no Radix wallet and no XRD. They still need
 * a stable key to hang a player row off, and that key used to be minted by the
 * browser (`"guest_" + Math.random()` in sessionStorage) and accepted by the
 * server on shape alone. Because the free 500-MEME starting balance is granted
 * once per address, "make up a new address" was the same operation as "mint
 * yourself 500 MEME" — see docs/GAME-DESIGN-REVIEW.md §5.
 *
 * Now the server issues them:
 *
 *   guest_<nonce:12 hex><tag:16 hex>
 *          └ 48 bits random  └ HMAC-SHA256(secret, "guest-id:v1:" + nonce), truncated
 *
 * The tag is what a client cannot produce, so `validateAddress` can tell a real
 * guest id from an invented one without a DB lookup on the hot path. 64 tag bits
 * is far past what the rate limiter (60 POST/min, 120 GET/min per IP) leaves
 * reachable by brute force, and the nonce only has to be unique, not secret.
 *
 * The whole id stays within `[a-z0-9]` and under 32 characters after the
 * prefix, so it is a drop-in replacement everywhere a guest address already
 * flowed (player rows, ledgers, the `NOT LIKE 'account_%'` mint-queue guard).
 *
 * Deliberately NOT ROLA: a guest has no wallet, so they can never hold a ROLA
 * session. This layer exists precisely so guest play stays open while
 * ROLA_AUTH_MODE remains `legacy` (CLAUDE.md).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getDb } from "../db/connection";

const PREFIX = "guest_";
const NONCE_HEX = 12; // 48 bits of uniqueness
const TAG_HEX = 16; // 64 bits of unforgeability

/** Exactly the shape `issueGuestId()` emits. Shape only — says nothing about the signature. */
const SIGNED_SHAPE = new RegExp(`^${PREFIX}[0-9a-f]{${NONCE_HEX + TAG_HEX}}$`);

/**
 * The pre-2026-08-21 client-minted shape (`Math.random().toString(36)`), which
 * is also what `validateAddress` used to accept from anyone. Matching this is
 * NOT sufficient to be valid any more — see `isKnownLegacyGuestId`.
 */
const LEGACY_SHAPE = /^guest_[a-z0-9]{8,32}$/;

const SECRET_NAME = "guest_id_hmac";
const MIN_ENV_SECRET_LEN = 16;

// ── Secret ──────────────────────────────────────────────────────────

let cachedSecret: Buffer | null = null;

/**
 * The HMAC key. `GUEST_ID_SECRET` wins when set; otherwise a random 256-bit key
 * is generated once and persisted in `server_secrets` (migration 015).
 *
 * The auto-generated fallback is the important half: guest play is meant to
 * work with zero configuration, and if a missing env var disabled signing then
 * a deploy that forgot to set it would silently reopen the faucet this module
 * exists to close. Setting the env var is still preferable in production — it
 * survives a DB move and can be shared if the server is ever run as more than
 * one process.
 *
 * Rotating the key (either way) invalidates every outstanding guest id. That
 * costs a guest their session-scoped account, not a wallet or on-chain asset.
 */
function secret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.GUEST_ID_SECRET;
  if (fromEnv && fromEnv.length >= MIN_ENV_SECRET_LEN) {
    cachedSecret = Buffer.from(fromEnv, "utf8");
    // Say which key is in use. Swapping between env and DB-persisted silently
    // invalidates every outstanding guest id — and a guest id IS the account,
    // so that reads to the player as "my balance and board vanished". One log
    // line makes an accidental swap visible in the boot output instead.
    console.log("[guest-id] signing key: GUEST_ID_SECRET (env)");
    return cachedSecret;
  }
  if (fromEnv) {
    // Never fall back silently — a 4-character secret that looks configured is
    // worse than an obviously absent one.
    console.warn(
      `[guest-id] GUEST_ID_SECRET is shorter than ${MIN_ENV_SECRET_LEN} chars — ignoring it ` +
        `and using the DB-persisted key instead. Set a longer one or unset it.`
    );
  }

  cachedSecret = loadOrCreatePersistedSecret();
  console.log("[guest-id] signing key: DB-persisted (server_secrets.guest_id_hmac)");
  return cachedSecret;
}

function loadOrCreatePersistedSecret(): Buffer {
  const db = getDb();
  try {
    // INSERT OR IGNORE, then read: whichever caller gets there first sets the
    // key and everyone else reads the same value. Never "read, then write if
    // missing" — that races into two different keys on a cold start.
    db.prepare("INSERT OR IGNORE INTO server_secrets (name, value) VALUES (?, ?)").run(
      SECRET_NAME,
      randomBytes(32).toString("hex")
    );
    const row = db
      .prepare("SELECT value FROM server_secrets WHERE name = ?")
      .get(SECRET_NAME) as { value: string } | undefined;
    if (!row) throw new Error("server_secrets row vanished immediately after insert");
    return Buffer.from(row.value, "utf8");
  } catch (err) {
    // The overwhelmingly likely cause is a restart on a stale `dist` that never
    // copied migration 015 (the exact failure mode CLAUDE.md warns about), so
    // name it rather than surfacing a bare "no such table".
    throw new Error(
      `[guest-id] cannot read the guest-id signing key: ${
        err instanceof Error ? err.message : String(err)
      }. Migration 015_guest_identity.sql may not have run — 'npm run build' in server/ ` +
        `is what copies migrations into dist/, then restart. Or set GUEST_ID_SECRET in env.`
    );
  }
}

/** Test-only: drop the memoized key so a test can swap GUEST_ID_SECRET. */
export function resetGuestSecretCacheForTests(): void {
  cachedSecret = null;
}

// ── Issue / verify ──────────────────────────────────────────────────

function tagFor(nonce: string): string {
  return createHmac("sha256", secret())
    .update(`guest-id:v1:${nonce}`)
    .digest("hex")
    .slice(0, TAG_HEX);
}

/** Mint a fresh signed guest id. Does not touch the issuance log — see `recordGuestIssue`. */
export function issueGuestId(): string {
  const nonce = randomBytes(NONCE_HEX / 2).toString("hex");
  return PREFIX + nonce + tagFor(nonce);
}

/** True iff `id` carries a tag this server's key produced. */
export function isServerIssuedGuestId(id: string): boolean {
  if (!SIGNED_SHAPE.test(id)) return false;

  const body = id.slice(PREFIX.length);
  const presented = Buffer.from(body.slice(NONCE_HEX), "hex");
  const expected = Buffer.from(tagFor(body.slice(0, NONCE_HEX)), "hex");

  // Lengths are fixed by SIGNED_SHAPE, but timingSafeEqual throws on a mismatch
  // rather than returning false, so check anyway.
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * True for a pre-existing client-minted guest id — the ones already in the
 * players table when this change shipped.
 *
 * Grandfathering is gated on the player row EXISTING, which is what keeps the
 * faucet shut: an unsigned id that names no player is rejected, so it can never
 * reach `getOrCreatePlayer` and can never collect a starting balance. Guessing
 * a real one means guessing 12 base36 characters (~62 bits) through a 120 GET/min
 * limiter, and the prize would be an account that already spent its free MEME.
 *
 * There is no sunset on this: these accounts hold real balances and boards, and
 * expiring them would delete a player's progress to buy nothing.
 */
export function isKnownLegacyGuestId(id: string): boolean {
  if (!LEGACY_SHAPE.test(id)) return false;
  return (
    getDb().prepare("SELECT 1 FROM players WHERE radix_address = ? LIMIT 1").get(id) !== undefined
  );
}

/** The predicate `validateAddress` uses for the `guest_…` half of an address. */
export function isValidGuestId(id: string): boolean {
  return isServerIssuedGuestId(id) || isKnownLegacyGuestId(id);
}

/** True for anything *claiming* to be a guest id, valid or not. Use to pick the error message. */
export function looksLikeGuestId(id: string): boolean {
  return id.startsWith(PREFIX);
}

// ── Per-IP issuance quota ───────────────────────────────────────────

/** Rolling window the quota is counted over. */
export const GUEST_QUOTA_WINDOW_SEC = 24 * 60 * 60;

const DEFAULT_QUOTA_PER_IP = 5;

/**
 * How many guest ids one IP may be issued per rolling day.
 *
 * This is the second half of the fix and the one that actually bounds the
 * giveaway: signing stops a client inventing ids, and this stops it asking the
 * server for an unlimited number instead. At the default, an IP can mint at
 * most 5 × FREE_STARTING_BALANCE per day.
 *
 * Set low on purpose. A real guest needs exactly one, and the handful of extras
 * cover a shared NAT, a phone plus a laptop, and someone clearing their tab.
 */
export function guestQuotaPerIp(): number {
  const raw = process.env.GUEST_MAX_PER_IP_PER_DAY;
  if (!raw) return DEFAULT_QUOTA_PER_IP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    console.warn(
      `[guest-id] GUEST_MAX_PER_IP_PER_DAY=${raw} is not an integer in 1..1000 — using ${DEFAULT_QUOTA_PER_IP}.`
    );
    return DEFAULT_QUOTA_PER_IP;
  }
  return n;
}

/**
 * The address the quota is counted against.
 *
 * IPv4 buckets on the exact address. IPv6 buckets on the /64 prefix, because
 * a single subscriber is routinely delegated a whole /64 (often a /56 or wider)
 * — keying on the full address would hand one person 2^64 independent quotas and
 * make the limit decorative. That is the same "bounds throughput but not size"
 * failure the guest faucet had in the first place.
 *
 * Exported for tests.
 */
export function quotaBucketFor(ip: string): string {
  // Strip an IPv6 zone index ("fe80::1%eth0") and unwrap IPv4-mapped form
  // ("::ffff:203.0.113.7"), which is how a dual-stack listener reports IPv4.
  const bare = ip.split("%")[0];
  const unmapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (unmapped) return unmapped[1];
  if (!bare.includes(":")) return bare; // plain IPv4, or "unknown"

  // Expand "::" so the first four groups are the real first four.
  let groups: string[];
  if (bare.includes("::")) {
    const [head, tail] = bare.split("::");
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
    groups = [...headGroups, ...new Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = bare.split(":");
  }

  const prefix = groups
    .slice(0, 4)
    .map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
  return `${prefix}::/64`;
}

/**
 * Keyed hash of a client's quota bucket.
 *
 * Keyed rather than a plain digest so the stored column is not a
 * brute-forceable list of visitor IPs (the space is small enough to enumerate).
 * Domain-separated from the id tag so the two uses of the key can't be
 * confused with each other.
 */
export function hashIp(ip: string): string {
  return createHmac("sha256", secret())
    .update(`guest-ip:v1:${quotaBucketFor(ip)}`)
    .digest("hex")
    .slice(0, 32);
}

export interface QuotaState {
  used: number;
  quota: number;
  remaining: number;
}

export function guestQuotaFor(ipHash: string): QuotaState {
  const since = Math.floor(Date.now() / 1000) - GUEST_QUOTA_WINDOW_SEC;
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM guest_ids WHERE ip_hash = ? AND created_at > ?")
    .get(ipHash, since) as { n: number };
  const quota = guestQuotaPerIp();
  return { used: row.n, quota, remaining: Math.max(0, quota - row.n) };
}

export function recordGuestIssue(guestAddress: string, ipHash: string, userAgent?: string | null): void {
  getDb()
    .prepare("INSERT INTO guest_ids (guest_address, ip_hash, user_agent) VALUES (?, ?, ?)")
    .run(guestAddress, ipHash, userAgent ? userAgent.slice(0, 200) : null);
}

/**
 * Count + insert as one step.
 *
 * better-sqlite3 is synchronous, so nothing can interleave between the count
 * and the insert inside this process, and the server runs as a single pm2
 * process — the quota cannot be beaten by firing concurrent requests. The
 * transaction is here so that stays true if the server is ever forked.
 */
export function issueGuestIdWithinQuota(
  ipHash: string,
  userAgent?: string | null
): { ok: true; guestId: string; remaining: number } | { ok: false; quota: number } {
  const db = getDb();
  return db.transaction(() => {
    const state = guestQuotaFor(ipHash);
    if (state.remaining <= 0) return { ok: false as const, quota: state.quota };

    // The id is the table's primary key and the tag is a pure function of the
    // nonce, so two draws of the same 48-bit nonce collide. That needs ~2^24
    // ids ever issued to be likely, but an unhandled collision would be a bare
    // 500 on a public endpoint — retry with a fresh nonce instead. A failed
    // INSERT aborts only the statement, so the surrounding transaction and the
    // quota count above both stay valid.
    for (let attempt = 0; attempt < 3; attempt++) {
      const guestId = issueGuestId();
      try {
        recordGuestIssue(guestId, ipHash, userAgent);
        return { ok: true as const, guestId, remaining: state.remaining - 1 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(msg)) throw err;
      }
    }
    throw new Error("[guest-id] could not draw an unused nonce in 3 attempts");
  })();
}
