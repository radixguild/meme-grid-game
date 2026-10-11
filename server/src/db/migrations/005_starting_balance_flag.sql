-- Add idempotency flag for free starting balance credit
-- Prevents double-crediting on repeated GET /game/:address calls
ALTER TABLE players ADD COLUMN starting_balance_credited INTEGER NOT NULL DEFAULT 0;
