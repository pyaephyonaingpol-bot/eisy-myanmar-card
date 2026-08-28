-- DEPRECATED — NOWPayments integration removed in favour of the custom TRON gateway.
-- Use supabase/orders.sql (or the `orders` table in supabase/schema.sql) instead.
--
-- If this legacy table already exists in your project, you may drop it after migrating data:
--   DROP TABLE IF EXISTS transactions;

-- Legacy NOWPayments transactions table (do not run for new deployments).

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  payment_id TEXT NOT NULL UNIQUE,
  amount NUMERIC(18, 8) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT,
  order_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_id ON transactions (payment_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_transactions" ON transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);
