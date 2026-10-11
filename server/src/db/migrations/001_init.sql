-- Players
CREATE TABLE IF NOT EXISTS players (
  radix_address TEXT PRIMARY KEY,
  display_name TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  meme_balance INTEGER DEFAULT 0,
  total_meme_deposited INTEGER DEFAULT 0,
  total_meme_spent INTEGER DEFAULT 0,
  total_boards INTEGER DEFAULT 0,
  total_rolls INTEGER DEFAULT 0,
  best_score INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  last_active INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_players_level ON players(level DESC, xp DESC);
CREATE INDEX IF NOT EXISTS idx_players_active ON players(last_active DESC);

-- Boards
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL REFERENCES players(radix_address),
  grid TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  rolls_used INTEGER DEFAULT 0,
  extra_turns INTEGER DEFAULT 0,
  wild_cards INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  cells_completed INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_boards_player ON boards(radix_address, status);
CREATE INDEX IF NOT EXISTS idx_boards_score ON boards(score DESC);

-- Roll audit trail
CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id),
  radix_address TEXT NOT NULL,
  cell_row INTEGER NOT NULL,
  cell_col INTEGER NOT NULL,
  cell_type TEXT NOT NULL,
  old_hits INTEGER NOT NULL,
  new_hits INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  score_change INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  special_effect TEXT,
  used_extra INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_rolls_board ON rolls(board_id);

-- Token deposits
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  xrd_amount TEXT NOT NULL,
  meme_amount INTEGER NOT NULL,
  verified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_deposits_address ON deposits(radix_address);
