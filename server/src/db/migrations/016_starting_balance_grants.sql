-- ═══ Per-IP metering of the free starting balance ═══
-- Second half of the PROJECT-STATE item 14 mitigation. Migration 015 metered
-- GUEST identity creation; this meters the other door.
--
-- `GET /api/game/:address` funds any address it has not seen before with
-- FREE_STARTING_BALANCE. For guests that is now bounded by GUEST_MAX_PER_IP_PER_DAY.
-- For `account_…` addresses it was bounded by nothing at all — `validateAddress`
-- checked only the SHAPE of the address, and ROLA_AUTH_MODE=legacy proves no
-- ownership, so anyone could mint funded accounts at the rate limiter's ceiling
-- (~86,400 MEME/day/IP at 120 GET/min).
--
-- Checksum validation (auth/address-validation.ts) closes the *fabricated*
-- address half. It cannot close the other half: an attacker can generate real
-- keypairs offline for free and derive perfectly valid addresses. Only a quota
-- bounds that, and only per-route ROLA (open item 3) truly fixes it.
--
-- Same shape and same reasoning as 015's `guest_ids`: the row IS the control,
-- the quota is a COUNT over it, and the history is what makes "which network
-- funded these 200 accounts" answerable after the fact.
CREATE TABLE IF NOT EXISTS starting_balance_grants (
  radix_address TEXT PRIMARY KEY,       -- the account that was funded
  ip_hash TEXT NOT NULL,                -- HMAC(server secret, quota bucket) — never a raw IP
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  CHECK (length(ip_hash) > 0)
);

-- The quota query is COUNT(*) WHERE ip_hash = ? AND created_at > ?.
CREATE INDEX IF NOT EXISTS idx_sbg_ip_created ON starting_balance_grants(ip_hash, created_at);

-- Backfill the accounts already funded before this migration, so the history is
-- complete and a pre-existing player is never re-counted as a new grant. Their
-- originating IP was never recorded and cannot be recovered, so it is marked
-- 'legacy' — a value hashIp() can never produce (it emits 32 hex chars), so
-- these rows can never collide with, or be counted against, a real IP bucket.
INSERT OR IGNORE INTO starting_balance_grants (radix_address, ip_hash, created_at)
SELECT radix_address, 'legacy', COALESCE(created_at, strftime('%s','now'))
FROM players
WHERE starting_balance_credited = 1;
