-- Achievements
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL REFERENCES players(radix_address),
  achievement_key TEXT NOT NULL,
  achievement_name TEXT NOT NULL,
  board_id INTEGER,
  score INTEGER,
  xp_awarded INTEGER DEFAULT 0,
  nft_key TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_achievements_player ON achievements(radix_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_unique ON achievements(radix_address, achievement_key);

-- NFT unlocks
CREATE TABLE IF NOT EXISTS nft_unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL REFERENCES players(radix_address),
  nft_key TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK(rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
  unlocked_via TEXT NOT NULL,
  board_id INTEGER,
  minted_on_chain INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_nft_player ON nft_unlocks(radix_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_unique ON nft_unlocks(radix_address, nft_key);
