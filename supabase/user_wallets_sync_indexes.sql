-- =============================================================================
-- Eisy Myanmar — indexes for admin Supabase wallet mirror sync / status
-- =============================================================================
-- Safe to re-run in the Supabase SQL Editor.
-- Speeds up count/head checks and user_id lookups used during chunked backfill.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id
  ON public.user_wallets (user_id);

CREATE INDEX IF NOT EXISTS idx_user_wallets_email_lower
  ON public.user_wallets (lower(email));

CREATE INDEX IF NOT EXISTS idx_user_wallets_updated_at
  ON public.user_wallets (updated_at DESC);

-- Optional auth link used when present on newer schemas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_wallets'
      AND column_name = 'auth_user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_wallets_auth_user_id ON public.user_wallets (auth_user_id)';
  END IF;
END $$;
