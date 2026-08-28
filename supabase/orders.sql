-- Custom TRON USDT (TRC20) payment gateway — orders table
-- Run in Supabase SQL Editor when enabling the on-chain deposit gateway.
--
-- Replaces the legacy NOWPayments Supabase schema (supabase/nowpayments_transactions.sql).
-- Each row tracks one deposit order: amount owed, assigned TRON deposit address, and status.

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

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_orders" ON orders
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Optional Realtime (poll/indexer can also drive UI updates):
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
