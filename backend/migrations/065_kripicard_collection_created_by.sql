-- Allow transaction_logs.created_by = 'kripicard_collection' for Master Wallet credits.
-- SQLite cannot ALTER CHECK constraints — rebuild the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS transaction_logs__v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  direction TEXT DEFAULT 'neutral' CHECK(direction IN ('credit', 'debit', 'neutral')),
  amount_usd REAL,
  amount_mmk REAL,
  balance_before REAL,
  balance_after REAL,
  reference_type TEXT,
  reference_id INTEGER,
  description TEXT NOT NULL,
  metadata TEXT,
  ip_address TEXT,
  created_by TEXT DEFAULT 'system' CHECK(created_by IN (
    'system',
    'user',
    'admin',
    'listener',
    'blockchain',
    'binance_pay',
    'test-bypass',
    'tron-indexer',
    'kripicard_collection'
  )),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO transaction_logs__v4 (
  id, user_id, type, direction, amount_usd, amount_mmk,
  balance_before, balance_after, reference_type, reference_id,
  description, metadata, ip_address, created_by, created_at
)
SELECT
  id,
  user_id,
  type,
  CASE direction
    WHEN 'credit' THEN direction
    WHEN 'debit' THEN direction
    ELSE 'neutral'
  END,
  amount_usd,
  amount_mmk,
  balance_before,
  balance_after,
  reference_type,
  reference_id,
  description,
  metadata,
  ip_address,
  CASE created_by
    WHEN 'system' THEN created_by
    WHEN 'user' THEN created_by
    WHEN 'admin' THEN created_by
    WHEN 'listener' THEN created_by
    WHEN 'blockchain' THEN created_by
    WHEN 'binance_pay' THEN created_by
    WHEN 'test-bypass' THEN created_by
    WHEN 'tron-indexer' THEN created_by
    WHEN 'kripicard_collection' THEN created_by
    ELSE 'system'
  END,
  created_at
FROM transaction_logs;

DROP TABLE transaction_logs;
ALTER TABLE transaction_logs__v4 RENAME TO transaction_logs;

CREATE INDEX IF NOT EXISTS idx_transaction_logs_user ON transaction_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_type ON transaction_logs(type);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_reference ON transaction_logs(reference_type, reference_id);

PRAGMA foreign_keys=ON;
