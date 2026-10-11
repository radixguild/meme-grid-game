-- Persistent transaction tracking for idempotency + orphaned TX recovery
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_hash TEXT NOT NULL UNIQUE,
  manifest_hash TEXT,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','submitted','committed','failed','timeout','recovered')),
  submitted_at INTEGER DEFAULT (strftime('%s','now')),
  resolved_at INTEGER,
  error_detail TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(intent_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_manifest ON transactions(manifest_hash);
