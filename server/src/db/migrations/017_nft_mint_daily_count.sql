-- ═══ Daily cap on NFT mint transactions (NFT_MINT_DAILY_CAP) ═══
-- One row per UTC day. `started` counts mint attempts the worker has begun
-- that day, retries included, because every submitted mint pays a network fee
-- from the signing account. services/mint-cap.ts reads the cap; the worker in
-- services/nft-minter.ts increments this in the same transaction that claims a
-- queue row, and claims nothing once the day's count reaches the cap. Rows that
-- wait stay `pending`/`failed` with their attempts unchanged, so the cap never
-- marks a mint failed and never drops an entitlement.
CREATE TABLE IF NOT EXISTS nft_mint_daily_count (
  day TEXT PRIMARY KEY,                     -- YYYY-MM-DD, UTC
  started INTEGER NOT NULL DEFAULT 0 CHECK (started >= 0)
);
