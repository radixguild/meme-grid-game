-- Async NFT minting queue — decouples mint from gameplay
CREATE TABLE IF NOT EXISTS nft_mint_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nft_unlock_id INTEGER NOT NULL REFERENCES nft_unlocks(id),
  radix_address TEXT NOT NULL,
  nft_key TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','minting','minted','failed')),
  tx_hash TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  minted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nft_mint_queue_status ON nft_mint_queue(status);
CREATE INDEX IF NOT EXISTS idx_nft_mint_queue_address ON nft_mint_queue(radix_address);
