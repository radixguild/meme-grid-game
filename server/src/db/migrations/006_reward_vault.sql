-- Reward vault: holds gifted meme coins for distribution through gameplay
CREATE TABLE IF NOT EXISTS vault_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_name TEXT NOT NULL UNIQUE,
  token_resource TEXT,                        -- on-chain resource address (nullable until on-chain)
  total_deposited REAL NOT NULL DEFAULT 0,
  total_distributed REAL NOT NULL DEFAULT 0,
  remaining REAL GENERATED ALWAYS AS (total_deposited - total_distributed) STORED,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Reward config: configurable triggers per token
CREATE TABLE IF NOT EXISTS reward_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,                  -- 'lucky_drop', 'milestone', 'tournament'
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Lucky drop settings
  drop_chance REAL DEFAULT 0.15,               -- 15% default
  drop_min REAL DEFAULT 1,
  drop_max REAL DEFAULT 10,
  -- Milestone settings (JSON array of {boards: N, amount: N})
  milestone_config TEXT,
  -- Tournament settings
  tournament_pool_pct REAL DEFAULT 0.1,        -- 10% of vault per tournament
  tournament_splits TEXT DEFAULT '[50, 30, 20]', -- top 3 split percentages
  UNIQUE(token_name, trigger_type)
);

-- Reward history: every reward given
CREATE TABLE IF NOT EXISTS reward_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL,
  token_name TEXT NOT NULL,
  amount REAL NOT NULL,
  trigger_type TEXT NOT NULL,                  -- 'lucky_drop', 'milestone', 'tournament'
  trigger_detail TEXT,                         -- e.g. '50 boards', 'weekly #12', 'cell_complete'
  board_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending', 'claimed', 'distributed'
  created_at INTEGER DEFAULT (strftime('%s','now')),
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reward_history_address ON reward_history(radix_address);
CREATE INDEX IF NOT EXISTS idx_reward_history_status ON reward_history(status);

-- Faucet claims: XRD fee subsidy for new users
CREATE TABLE IF NOT EXISTS faucet_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radix_address TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending', 'sent', 'failed'
  tx_hash TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_faucet_claims_address ON faucet_claims(radix_address);
