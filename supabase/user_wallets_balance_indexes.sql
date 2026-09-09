-- Speed up user_wallets email fallback lookups used by balance overlay.
-- Safe to re-run in the Supabase SQL Editor.

CREATE INDEX IF NOT EXISTS idx_user_wallets_email_lower
  ON user_wallets (lower(email));

CREATE INDEX IF NOT EXISTS idx_user_wallets_updated_at
  ON user_wallets (updated_at DESC);
