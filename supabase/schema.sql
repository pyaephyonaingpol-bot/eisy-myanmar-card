-- Eisy Myanmar — Supabase schema for synced app state
-- Run in Supabase SQL Editor.
--
-- Realtime replication (Database → Replication) is OPTIONAL.
-- The live site reads balances via API fresh queries to user_wallets,
-- so Table Editor edits appear without enabling Realtime.
--
-- Supabase Auth signup trigger fix (handle_new_user / profiles):
-- see supabase/auth_profiles.sql if auth.signUp() returns "Database error saving new user".

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  balance_mmk NUMERIC(18, 2) NOT NULL DEFAULT 0,
  balance_usdt NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tron_deposit_address TEXT,
  tron_derivation_index INTEGER,
  tron_derivation_path TEXT,
  auth_status TEXT NOT NULL DEFAULT 'active',
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  amount_mmk NUMERIC(18, 2) DEFAULT 0,
  amount_usd NUMERIC(18, 4) DEFAULT 0,
  ref_code TEXT,
  payment_method TEXT,
  deposit_currency TEXT NOT NULL DEFAULT 'USDT' CHECK (deposit_currency = 'USDT'),
  status TEXT NOT NULL DEFAULT 'PENDING',
  purpose TEXT DEFAULT 'topup',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_user ON deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_created ON deposit_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS card_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  card_holder_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  display_status TEXT DEFAULT 'PENDING_ISSUANCE',
  pricing JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  deposit_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_applications_user ON card_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_card_applications_status ON card_applications(status);

CREATE TABLE IF NOT EXISTS card_reload_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  card_id TEXT,
  wallet_type TEXT NOT NULL DEFAULT 'usdt' CHECK (wallet_type = 'usdt'),
  amount_mmk NUMERIC(18, 2),
  amount_usdt NUMERIC(18, 4),
  net_usd_to_card NUMERIC(18, 4),
  status TEXT NOT NULL DEFAULT 'pending',
  pricing JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_reload_user ON card_reload_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_card_reload_status ON card_reload_requests(status);

-- Custom TRON USDT (TRC20) payment gateway orders (replaces NOWPayments Supabase sync).
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE,
  user_id BIGINT,
  local_deposit_id BIGINT,
  ref_code TEXT,
  amount NUMERIC(18, 8) NOT NULL,
  deposit_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  tx_hash TEXT,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_deposit_address ON orders (deposit_address);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_local_deposit_id ON orders (local_deposit_id);

-- Permissive policies for demo (app uses its own Express auth).
-- CRITICAL: anon_all policies allowed anyone with the public anon key to
-- read/write wallets. Production MUST use service_role-only policies.
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reload_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop dangerous open policies if they exist from earlier deploys.
DROP POLICY IF EXISTS "anon_all_user_wallets" ON user_wallets;
DROP POLICY IF EXISTS "anon_all_deposit_requests" ON deposit_requests;
DROP POLICY IF EXISTS "anon_all_card_applications" ON card_applications;
DROP POLICY IF EXISTS "anon_all_card_reload_requests" ON card_reload_requests;

-- Service role only (backend uses SUPABASE_SERVICE_ROLE_KEY).
DROP POLICY IF EXISTS "service_role_user_wallets" ON user_wallets;
CREATE POLICY "service_role_user_wallets" ON user_wallets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_deposit_requests" ON deposit_requests;
CREATE POLICY "service_role_deposit_requests" ON deposit_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_card_applications" ON card_applications;
CREATE POLICY "service_role_card_applications" ON card_applications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_card_reload_requests" ON card_reload_requests;
CREATE POLICY "service_role_card_reload_requests" ON card_reload_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_orders" ON orders;
CREATE POLICY "service_role_orders" ON orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable Realtime (run after tables exist):
-- ALTER PUBLICATION supabase_realtime ADD TABLE user_wallets;
-- ALTER PUBLICATION supabase_realtime ADD TABLE deposit_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE card_applications;
-- ALTER PUBLICATION supabase_realtime ADD TABLE card_reload_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
