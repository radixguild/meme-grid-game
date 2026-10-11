-- ═══ Once-per-day-per-account daily-board guard (operator ruling 2026-08-13) ═══
--
-- The board stays SHARED (one layout per UTC day, for leaderboard comparability —
-- see getDailySeed() in game/grid.ts) but an account (including guest_* pseudo
-- accounts — validateAddress accepts both) may create at most ONE `{daily: true}`
-- board per UTC day. Without this, a player can complete (or abandon) today's
-- Daily Challenge board and immediately create another `{daily: true}` board the
-- same day: since the layout is deterministic per date, that mints a second row
-- of a board whose full cell-type layout the player already knows from the first
-- playthrough — free replays of a known board, i.e. farming.
--
-- `is_daily` / `daily_date` are populated ONLY on boards created with
-- `{daily: true}` (routes/game.ts). `daily_date` is the UTC calendar date string
-- (YYYY-MM-DD) used to derive that board's seed — passed explicitly by the route
-- rather than recomputed here, so the dedupe date and the seed date can never
-- drift apart from two separate `new Date()` calls straddling UTC midnight.
--
-- Enforcement is the UNIQUE INDEX below, not route logic: `db/queries/boards.ts`
-- ::createDailyBoardOnce() does a check-then-insert for the common case (no
-- wasted MEME charge on the expected path), but the index is what actually closes
-- the race for concurrent requests across processes — a second INSERT for the
-- same (radix_address, daily_date) throws a UNIQUE constraint failure, which the
-- query layer catches and turns into an idempotent return of the board that won,
-- mirroring the existing `roll_credits` (011) / `xp_credits` (012) ledger pattern
-- of "insert, catch UNIQUE, return the existing row" rather than pre-locking.
--
-- Partial index (`WHERE is_daily = 1`) so ordinary (non-daily) boards, which have
-- `daily_date IS NULL`, are completely unconstrained — a player can still start
-- as many regular boards, across as many days, as the existing "one active board
-- at a time" state-machine rule (game/state-machine.ts::validateNewBoard) allows.
ALTER TABLE boards ADD COLUMN is_daily INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN daily_date TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_daily_once
  ON boards(radix_address, daily_date) WHERE is_daily = 1;
