-- ROLA (Radix Off-Ledger Auth) + session management
--
-- Fixes the account-spoofing hole where any client could claim any
-- radix_address. With ROLA, the server verifies the client actually
-- controls the private key for the claimed address via a signed
-- challenge, then issues a session token that binds future requests
-- to the verified address.

CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge     TEXT    PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER               -- set when verified (single-use)
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token           TEXT    PRIMARY KEY,
  radix_address   TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  user_agent      TEXT,
  origin          TEXT,
  revoked_at      INTEGER               -- set if explicitly signed out
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_address ON auth_sessions(radix_address);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
