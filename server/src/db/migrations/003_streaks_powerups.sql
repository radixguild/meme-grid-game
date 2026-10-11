-- Streaks
ALTER TABLE players ADD COLUMN streak_current INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN streak_longest INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN streak_last_date TEXT;
ALTER TABLE players ADD COLUMN pity_counter INTEGER DEFAULT 0;

-- Power-up inventory
CREATE TABLE IF NOT EXISTS powerups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL REFERENCES players(radix_address),
  powerup_type TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  UNIQUE(radix_address, powerup_type)
);
CREATE INDEX IF NOT EXISTS idx_powerups_player ON powerups(radix_address);

-- Line completion tracking per board
CREATE TABLE IF NOT EXISTS line_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  radix_address TEXT NOT NULL,
  line_type TEXT NOT NULL,
  line_index INTEGER NOT NULL,
  reward INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Pattern completion tracking per board
CREATE TABLE IF NOT EXISTS pattern_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  radix_address TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  reward INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Track completed lines per board to avoid double-counting
ALTER TABLE boards ADD COLUMN lines_completed INTEGER DEFAULT 0;
ALTER TABLE boards ADD COLUMN patterns_completed INTEGER DEFAULT 0;
