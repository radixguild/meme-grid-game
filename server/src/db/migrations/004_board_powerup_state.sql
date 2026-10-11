-- Track active power-up effects on boards (X-Ray, Magnet)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so these will only
-- run once via the migration runner's tracking table (_migrations).
ALTER TABLE boards ADD COLUMN xray_remaining INTEGER DEFAULT 0;
ALTER TABLE boards ADD COLUMN magnet_remaining INTEGER DEFAULT 0;
