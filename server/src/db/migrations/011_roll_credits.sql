-- ═══ Roll credit ledger ═══
-- ONE place recording where every roll came from. Rolls are denominated in MEME
-- (ROLL_COST = 1), and MEME is a server-side balance, so this is a credit ledger.
--
-- Why this exists (2026-07-26): the game is an incentive machine for the Radix Guild
-- AND a Radix onboarding tool. Both audiences acquire rolls, by different routes —
-- guild task completion, direct purchase (XRD/fUSD/…), daily streaks, promos. Those
-- are all the same operation: credit rolls to a player. Recording them through one
-- ledger with a `source` means:
--   * a new source is a ROW, not a code change (the guild link is `source='guild_task'`)
--   * "how much of the giveaway is revenue vs promo" becomes answerable at all
--   * refunds and abuse forensics become possible
--   * (source, source_ref) uniqueness makes double-crediting a task/tx impossible
--
-- `amount` is SIGNED: positive = credit. Spends are not recorded yet, but recording
-- them later needs no migration — insert negative rows.

CREATE TABLE IF NOT EXISTS roll_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL,
  amount INTEGER NOT NULL,                       -- MEME. positive = credit, negative = debit
  source TEXT NOT NULL,                          -- see the vocabulary below
  source_ref TEXT,                               -- tx hash | guild task id | promo code | NULL
  note TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),

  -- Open vocabulary on purpose — a new source must not require a migration. Known:
  --   'free_start'  first-visit free balance (Phase 1 onboarding)
  --   'purchase'    paid for on-chain (source_ref = tx hash)
  --   'guild_task'  earned by completing a guild task (source_ref = task id)
  --   'daily'       daily streak / check-in reward
  --   'promo'       manual or campaign grant
  --   'refund'      correction / goodwill
  CHECK (length(source) > 0),
  CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_roll_credits_address ON roll_credits(radix_address);
CREATE INDEX IF NOT EXISTS idx_roll_credits_source ON roll_credits(source);
CREATE INDEX IF NOT EXISTS idx_roll_credits_created ON roll_credits(created_at);

-- Idempotency: a given (source, source_ref) can be credited at most ONCE, ever.
-- This is the property that makes the guild link safe to wire later — a replayed
-- task-completion event, a double-submitted tx hash, or a re-used promo code
-- cannot mint a second credit. Partial index so unreferenced grants (source_ref
-- NULL, e.g. ad-hoc promos) stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_roll_credits_source_ref_unique
  ON roll_credits(source, source_ref) WHERE source_ref IS NOT NULL;
