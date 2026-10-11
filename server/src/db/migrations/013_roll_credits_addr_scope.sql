-- ═══ Scope roll-credit idempotency per player ═══
-- 011's `idx_roll_credits_source_ref_unique` was UNIQUE on (source, source_ref)
-- with no radix_address — global across players. That is correct for refs that
-- are globally unique anyway (purchase tx hashes) but wrong for refs that are
-- naturally SHARED across players: routes/daily.ts uses the check-in DATE
-- (`2026-08-13:meme`), so the first player to check in each UTC day claimed the
-- ref for everyone — every later player's creditRolls() hit the constraint and
-- silently returned applied:false while the route still reported the reward.
-- Result: the daily streak reward credited exactly one player per day.
--
-- Fix: re-scope to (radix_address, source, source_ref) — the same design
-- 012_xp_credits.sql used from the start, for exactly this reason. Per-player
-- idempotency is what every source actually wants:
--   * 'daily'      — same date, different players: independent grants (the fix)
--   * 'free_start' — source_ref is the address itself; behavior unchanged
--   * 'purchase'   — replay protection does NOT rest on this index: deposits.tx_hash
--                    is UNIQUE (001_init.sql) and gates before the ledger insert,
--                    and verifyBuyMemeTransaction() ties the tx to the address
--   * 'guild_task' — "task X for player A" and "task X for player B" become
--                    independent, matching xp_credits; per-task claim exclusivity
--                    is the guild escrow's job, not this ledger's
--
-- Safe on existing data: the new index is scoped STRICTER (superset of columns),
-- so any rows unique under the old index are unique under the new one — the
-- CREATE cannot fail. No backfill of shorted daily rewards is possible: the
-- failed credits were never recorded anywhere (the route ignored applied:false),
-- so there is nothing to reconstruct them from.
DROP INDEX IF EXISTS idx_roll_credits_source_ref_unique;

-- Partial index kept: unreferenced grants (source_ref NULL, e.g. ad-hoc promos)
-- stay unconstrained, same as 011 and 012.
CREATE UNIQUE INDEX IF NOT EXISTS idx_roll_credits_addr_source_ref_unique
  ON roll_credits(radix_address, source, source_ref) WHERE source_ref IS NOT NULL;
