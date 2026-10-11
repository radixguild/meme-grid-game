-- ═══ Server-issued guest identities ═══
-- Closes the free-ROLLS faucet described in docs/GAME-DESIGN-REVIEW.md §5.
--
-- Before this migration a guest "address" was minted entirely client-side —
-- `"guest_" + Math.random()` written to sessionStorage — and the server accepted
-- any string matching `guest_[a-z0-9]{8,32}`. Since the free 500-MEME starting
-- balance is gated only on the address being new, a cleared tab was a brand-new
-- funded account, unbounded. Per-IP rate limiting bounded the *throughput* of
-- that faucet, never its size.
--
-- The fix has two halves, and both need a table:
--   1. guest ids are now issued by the server and HMAC-signed, so a self-minted
--      string fails validation (see auth/guest-id.ts). The signing key lives in
--      `server_secrets` unless GUEST_ID_SECRET is set in env.
--   2. issuance is metered per source IP, recorded in `guest_ids`.
--
-- Deliberately NOT touched: ROLA. A guest can never hold a ROLA session, so
-- flipping ROLA_AUTH_MODE to `required` would end guest play permanently
-- (CLAUDE.md). This closes the hole with the guest path left fully open.

-- ─── Server-held secrets ────────────────────────────────────────────────
-- Small key/value store for secrets the server generates for ITSELF. Today
-- that is one row: the HMAC key that signs guest ids.
--
-- Why persist rather than require env: guest play with zero setup is a product
-- requirement, and a deploy that forgets an env var must not silently reopen
-- the faucet. So the key is auto-generated on first use and kept here, and
-- GUEST_ID_SECRET (env) overrides it when an operator wants a key that
-- survives a DB move or is shared across instances.
--
-- ⚠️ This is a symmetric HMAC key for signing opaque session-scoped ids. It is
-- NOT a wallet, NOT a Radix signing key, and controls no funds. Nothing in
-- here may ever hold on-chain key material.
CREATE TABLE IF NOT EXISTS server_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- ─── Guest issuance log ─────────────────────────────────────────────────
-- One row per guest id the server has ever handed out. Same shape of thinking
-- as the 011/012 credit ledgers: the row IS the control, not a side effect —
-- the per-IP quota is a COUNT over this table, and the unique key makes an id
-- impossible to register twice.
--
-- `ip_hash` is an HMAC of the client IP under the same server secret, not the
-- IP itself: the quota only ever needs equality, so there is no reason to keep
-- raw addresses of people playing a dice game. It is keyed, so the table is
-- not a rainbow-table-able list of visitor IPs either.
--
-- Rows are kept past the quota window rather than pruned. Volume is bounded by
-- the quota itself (a few per IP per day), and the history is what makes
-- "which IP minted these 40 accounts" answerable after the fact — the same
-- forensics argument that made 011 a ledger instead of a counter.
CREATE TABLE IF NOT EXISTS guest_ids (
  guest_address TEXT PRIMARY KEY,       -- the full signed id, e.g. guest_<nonce><tag>
  ip_hash TEXT NOT NULL,                -- HMAC(server secret, client ip) — never the raw IP
  user_agent TEXT,                      -- truncated; abuse forensics only
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),

  CHECK (guest_address LIKE 'guest\_%' ESCAPE '\'),
  CHECK (length(ip_hash) > 0)
);

-- The quota query is `COUNT(*) WHERE ip_hash = ? AND created_at > ?`; this
-- index makes it a range scan over one IP rather than a table scan.
CREATE INDEX IF NOT EXISTS idx_guest_ids_ip_created ON guest_ids(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_guest_ids_created ON guest_ids(created_at);
