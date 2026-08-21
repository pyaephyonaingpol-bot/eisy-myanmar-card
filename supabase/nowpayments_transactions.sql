-- NOWPayments: Supabase transactions table (run in Supabase SQL Editor)
-- Tracks pending crypto payments by NOWPayments payment_id; IPN sets status = finished.

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

-- Optional Realtime:
-- ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
