-- TRON USDT TRC20 deposit indexer: deduplicate on-chain transfers and track orphans.

CREATE TABLE IF NOT EXISTS tron_indexed_transfers (
  tx_hash TEXT PRIMARY KEY,
  block_timestamp INTEGER NOT NULL,
  from_address TEXT,
  to_address TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  deposit_id INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT,
  FOREIGN KEY (deposit_id) REFERENCES deposit_requests_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_tron_indexed_transfers_status
  ON tron_indexed_transfers(status);

CREATE INDEX IF NOT EXISTS idx_tron_indexed_transfers_ts
  ON tron_indexed_transfers(block_timestamp);
