-- Add block status fields to the Supabase user_wallets mirror.
-- Run in Supabase SQL Editor (safe to re-run).

ALTER TABLE user_wallets
  ADD COLUMN IF NOT EXISTS auth_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE user_wallets
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_wallets_is_blocked
  ON user_wallets (is_blocked);

COMMENT ON COLUMN user_wallets.auth_status IS
  'Mirror of Turso users.auth_status (active|blocked|suspended)';
COMMENT ON COLUMN user_wallets.is_blocked IS
  'True when auth_status is blocked or suspended; admin Block User sets this via API sync';
