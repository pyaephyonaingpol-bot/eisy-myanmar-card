-- Dual-wallet architecture:
--   Master Wallet ledger  → users.balance_usdt        (Instant Card / Kripicard)
--   Bitnob user ledger    → users.balance_bitnob_usdt (Standard Card / Bitnob)
-- Deposits to Bitnob addresses credit the Bitnob ledger only.
-- Master/HD TRON deposits continue to credit balance_usdt only.

ALTER TABLE users ADD COLUMN balance_bitnob_usdt REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN bitnob_customer_id TEXT;
ALTER TABLE users ADD COLUMN bitnob_deposit_address TEXT;
ALTER TABLE users ADD COLUMN bitnob_deposit_chain TEXT;
ALTER TABLE users ADD COLUMN bitnob_deposit_address_id TEXT;
ALTER TABLE users ADD COLUMN bitnob_deposit_reference TEXT;

CREATE TABLE IF NOT EXISTS bitnob_wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
  amount_usdt REAL NOT NULL,
  balance_after REAL NOT NULL,
  journal_id TEXT NOT NULL,
  purpose TEXT,
  description TEXT,
  reference_type TEXT,
  reference_id TEXT,
  metadata TEXT,
  created_by TEXT DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bitnob_wallet_ledger_journal
  ON bitnob_wallet_ledger(journal_id);

CREATE INDEX IF NOT EXISTS idx_bitnob_wallet_ledger_user
  ON bitnob_wallet_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bitnob_deposit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  address TEXT,
  chain TEXT,
  amount_usdt REAL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  raw_payload TEXT,
  credited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bitnob_deposit_events_address
  ON bitnob_deposit_events(address);
