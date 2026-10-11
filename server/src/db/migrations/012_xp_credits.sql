-- ═══ XP credit ledger ═══
-- Mirrors 011_roll_credits.sql for the same reason: more than one code path
-- awards XP (dice rolls / power-ups via updatePlayerAfterRoll, achievement
-- unlocks, and eventually guild tasks), and without one seam + a
-- replay-proof ledger, "credit XP" turns into N call sites that drift or
-- double-fire. This is the table behind queries/xp-credits.ts::creditXp(),
-- the single function ALL XP mutations now flow through.
--
-- ⚠️ Unlike 011's `idx_roll_credits_source_ref_unique`, this index is scoped
-- by radix_address AS WELL AS (source, source_ref). 011's index is NOT
-- address-scoped, so a source_ref that is naturally shared across players
-- (routes/daily.ts uses the check-in DATE, not a per-player value) can only
-- ever be credited for the FIRST player who claims it that day — every other
-- player's `creditRolls()` call silently returns `applied: false` while the
-- route reports success anyway. That was a real, live bug in 011 (fixed in
-- 013_roll_credits_addr_scope.sql, which re-scoped 011's index to match this
-- one). Do not repeat
-- it: this table's uniqueness is per-player, so "achievement X for address A"
-- and "achievement X for address B" are independent grants, and the same
-- achievement re-unlocking (or a backfill re-running) for ONE address can
-- still never double-credit.
CREATE TABLE IF NOT EXISTS xp_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL REFERENCES players(radix_address),
  amount INTEGER NOT NULL,                       -- XP. Always positive — no XP debits yet.
  source TEXT NOT NULL,                          -- see the vocabulary below
  source_ref TEXT,                               -- achievement_key | task id | NULL
  note TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),

  -- Open vocabulary on purpose — a new source must not require a migration. Known:
  --   'roll'         gameplay XP via updatePlayerAfterRoll (rolls, wilds, power-ups)
  --   'achievement'  NFT/achievement unlock bonus (source_ref = achievement_key)
  --   'guild_task'   future guild-task XP (source_ref = task id)
  CHECK (length(source) > 0),
  CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_xp_credits_address ON xp_credits(radix_address);
CREATE INDEX IF NOT EXISTS idx_xp_credits_source ON xp_credits(source);
CREATE INDEX IF NOT EXISTS idx_xp_credits_created ON xp_credits(created_at);

-- Idempotency, scoped per player: a given (radix_address, source, source_ref)
-- can be credited at most ONCE, ever. This is the property that makes
-- achievement XP safe — a re-unlock attempt, a replayed award call, or this
-- very migration re-running cannot mint a second credit for the same
-- achievement on the same address. Partial index so un-keyed grants (the
-- 'roll' source, which has no natural per-event key) stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_credits_addr_source_ref_unique
  ON xp_credits(radix_address, source, source_ref) WHERE source_ref IS NOT NULL;

-- ─── Backfill: already-earned-but-uncredited achievement XP ───────────────
-- `achievements.xp_awarded` has been recorded since migration 002, but until
-- this release nothing ever added it to `players.xp` (PROJECT-STATE.md open
-- item 5). Credit it now, through the same ledger the live seam uses — every
-- row here is indistinguishable from one `creditXp()` would have written, so
-- this backfill and any future achievement credit can never double-count
-- each other.
--
-- The runner (runner.ts) tracks applied files in `_migrations` and will not
-- re-run this file in the normal case — but this block is written to also be
-- safe under a raw manual re-execution (e.g. `sqlite3 db < 012_xp_credits.sql`
-- during an incident), not just under the runner's bookkeeping. That needs
-- more than `INSERT OR IGNORE`: the ledger insert alone is idempotent, but a
-- bare `UPDATE players SET xp = xp + <sum>` is NOT — re-running it would
-- re-add the same delta a second time even though no new ledger rows landed.
-- So the delta is computed ONCE into a temp table via an explicit anti-join,
-- and every later statement in this block reads from that same temp table —
-- on a re-run the anti-join finds every achievement already has a ledger row
-- and the temp table comes back empty, making the inserts/updates below
-- true no-ops.
CREATE TEMP TABLE _xp_backfill_012 AS
SELECT a.radix_address AS radix_address, a.xp_awarded AS amount,
       a.achievement_key AS source_ref, a.created_at AS created_at
FROM achievements a
WHERE a.xp_awarded > 0
  AND NOT EXISTS (
    SELECT 1 FROM xp_credits xc
    WHERE xc.radix_address = a.radix_address
      AND xc.source = 'achievement'
      AND xc.source_ref = a.achievement_key
  );

INSERT INTO xp_credits (radix_address, amount, source, source_ref, note, created_at)
SELECT radix_address, amount, 'achievement', source_ref, 'backfill: 012_xp_credits.sql', created_at
FROM _xp_backfill_012;

UPDATE players SET xp = xp + COALESCE(
  (SELECT SUM(b.amount) FROM _xp_backfill_012 b WHERE b.radix_address = players.radix_address), 0
)
WHERE radix_address IN (SELECT radix_address FROM _xp_backfill_012);

-- Recompute `level` from the corrected xp, scoped to exactly the players the
-- backfill touched. This CASE mirrors the LEVELS thresholds in
-- `game/levels.ts` ONLY for this one-time historical correction — every live
-- credit through creditXp() derives level from levels.ts in TypeScript; this
-- SQL copy is not a new source of truth and must not be reused elsewhere.
UPDATE players SET level = CASE
  WHEN xp >= 300000 THEN 10
  WHEN xp >= 210000 THEN 9
  WHEN xp >= 140000 THEN 8
  WHEN xp >= 90000  THEN 7
  WHEN xp >= 55000  THEN 6
  WHEN xp >= 30000  THEN 5
  WHEN xp >= 15000  THEN 4
  WHEN xp >= 6000   THEN 3
  WHEN xp >= 2000   THEN 2
  ELSE 1
END
WHERE radix_address IN (SELECT radix_address FROM _xp_backfill_012);

DROP TABLE _xp_backfill_012;
