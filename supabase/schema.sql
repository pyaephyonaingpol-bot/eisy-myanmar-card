-- Eisy Myanmar — Supabase schema for synced app state
-- Run in Supabase SQL Editor, then enable Realtime for each table (Database → Replication).
--
-- Supabase Auth signup trigger fix (handle_new_user / profiles):
-- see supabase/auth_profiles.sql if auth.signUp() returns "Database error saving new user".

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  balance_mmk NUMERIC(18, 2) NOT NULL DEFAULT 0,
  balance_usdt NUMERIC(18, 4) NOT NULL DEFAULT 0,
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
  deposit_currency TEXT DEFAULT 'MMK',
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
  wallet_type TEXT DEFAULT 'mmk',
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

-- Permissive policies for demo (app uses its own Express auth).
-- Tighten with RLS + auth.uid() before production.
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reload_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_user_wallets" ON user_wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_deposit_requests" ON deposit_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_card_applications" ON card_applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_card_reload_requests" ON card_reload_requests FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime (run after tables exist):
-- ALTER PUBLICATION supabase_realtime ADD TABLE user_wallets;
-- ALTER PUBLICATION supabase_realtime ADD TABLE deposit_requests;
-- ALTER PUBLICATION supabase_realtime ADD TABLE card_applications;
-- ALTER PUBLICATION supabase_realtime ADD TABLE card_reload_requests;
