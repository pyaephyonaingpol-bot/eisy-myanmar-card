-- TRON gateway orders: link Supabase orders to app users + local deposits for wallet credit.
-- Run after supabase/orders.sql on existing deployments.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS local_deposit_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ref_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tx_hash TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_local_deposit_id ON orders (local_deposit_id);
