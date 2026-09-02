-- Harden Supabase RLS after unauthorized wallet incident.
-- Run in Supabase SQL Editor IMMEDIATELY.
--
-- Previous schema used anon_all_* policies which allowed anyone holding the
-- public anon key (exposed via /api/config/supabase) to READ/WRITE all rows.

ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_reload_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_user_wallets" ON user_wallets;
DROP POLICY IF EXISTS "anon_all_deposit_requests" ON deposit_requests;
DROP POLICY IF EXISTS "anon_all_card_applications" ON card_applications;
DROP POLICY IF EXISTS "anon_all_card_reload_requests" ON card_reload_requests;

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

-- Optional mirror of local Turso transaction_logs (why txs may be "missing" in Supabase).
CREATE TABLE IF NOT EXISTS transaction_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,
  direction TEXT,
  amount_usd NUMERIC(18, 4),
  amount_mmk NUMERIC(18, 2),
  amount_usdt NUMERIC(18, 4),
  balance_before NUMERIC(18, 4),
  balance_after NUMERIC(18, 4),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_user
  ON transaction_logs (user_id, created_at DESC);

ALTER TABLE transaction_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_transaction_logs" ON transaction_logs;
CREATE POLICY "service_role_transaction_logs" ON transaction_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS usdt_withdrawal_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ref_code TEXT,
  payout_method TEXT,
  network TEXT,
  wallet_address TEXT,
  amount_usdt NUMERIC(18, 4),
  fee_usdt NUMERIC(18, 4),
  net_usdt NUMERIC(18, 4),
  status TEXT,
  tx_hash TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE usdt_withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_usdt_withdrawal_requests" ON usdt_withdrawal_requests;
CREATE POLICY "service_role_usdt_withdrawal_requests" ON usdt_withdrawal_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
