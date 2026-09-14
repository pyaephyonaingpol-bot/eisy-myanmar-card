-- USDT Scan Pay: QR-initiated payments from the internal USDT wallet.

CREATE TABLE IF NOT EXISTS usdt_scan_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  destination_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  amount_usdt REAL NOT NULL,
  fee_usdt REAL NOT NULL DEFAULT 0,
  total_debit_usdt REAL NOT NULL,
  qr_payload TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  payout_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  payout_tx_hash TEXT,
  journal_id TEXT,
  note TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_usdt_scan_payments_user_created
  ON usdt_scan_payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_scan_payments_status
  ON usdt_scan_payments(status);

CREATE INDEX IF NOT EXISTS idx_usdt_scan_payments_destination
  ON usdt_scan_payments(destination_address);
