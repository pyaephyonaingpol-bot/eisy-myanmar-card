-- Per-user TRON HD deposit addresses (Supabase mirror of Turso custodial rows).
-- Run in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
--
-- Code writes to:
--   user_wallets.tron_deposit_address / tron_derivation_index / tron_derivation_path
--   user_tron_hd_addresses (preferred) and/or user_tron_deposit_addresses (legacy alias)

ALTER TABLE user_wallets
  ADD COLUMN IF NOT EXISTS tron_deposit_address TEXT;

ALTER TABLE user_wallets
  ADD COLUMN IF NOT EXISTS tron_derivation_index INTEGER;

ALTER TABLE user_wallets
  ADD COLUMN IF NOT EXISTS tron_derivation_path TEXT;

CREATE INDEX IF NOT EXISTS idx_user_wallets_tron_deposit_address
  ON user_wallets (tron_deposit_address);

-- Preferred HD address table (matches ops naming: user_tron_hd_addresses)
CREATE TABLE IF NOT EXISTS user_tron_hd_addresses (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL,
  derivation_path TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tron_hd_addresses_address
  ON user_tron_hd_addresses (address);

ALTER TABLE user_tron_hd_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_tron_hd_addresses'
      AND policyname = 'service_role_user_tron_hd_addresses'
  ) THEN
    CREATE POLICY "service_role_user_tron_hd_addresses"
      ON user_tron_hd_addresses FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Legacy alias table (older deploys / docs referenced this name)
CREATE TABLE IF NOT EXISTS user_tron_deposit_addresses (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL,
  derivation_path TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tron_deposit_addresses_address
  ON user_tron_deposit_addresses (address);

ALTER TABLE user_tron_deposit_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_tron_deposit_addresses'
      AND policyname = 'service_role_user_tron_deposit_addresses'
  ) THEN
    CREATE POLICY "service_role_user_tron_deposit_addresses"
      ON user_tron_deposit_addresses FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
