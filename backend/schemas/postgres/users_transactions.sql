-- PostgreSQL schemas: Users + Transactions
-- Payment ledger: deposit / withdraw with status + external txId

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance       NUMERIC(18, 8) NOT NULL DEFAULT 0
                CHECK (balance >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_balance ON users (balance);

-- ---------------------------------------------------------------------------
-- Transactions
-- type: deposit | withdraw
-- status: pending | processing | completed | failed | cancelled
-- txId: external provider reference (Binance trade no, chain hash, bank ref, …)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                CHECK (type IN ('deposit', 'withdraw')),
  amount        NUMERIC(18, 8) NOT NULL
                CHECK (amount > 0),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  "txId"        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions ("userId");
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_txid_unique
  ON transactions ("txId")
  WHERE "txId" IS NOT NULL;

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
