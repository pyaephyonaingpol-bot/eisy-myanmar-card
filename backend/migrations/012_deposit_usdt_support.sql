-- 012_deposit_usdt_support.sql
-- Relax payment_method CHECK and add USDT deposit columns (currency, network, tx_hash)

PRAGMA foreign_keys = OFF;

DROP VIEW IF EXISTS pending_deposit_reviews;

CREATE TABLE deposit_requests_v2_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_mmk REAL NOT NULL DEFAULT 0,
  amount_usd REAL NOT NULL,
  ref_code TEXT UNIQUE NOT NULL,
  payment_method TEXT DEFAULT 'KBZPay',
  deposit_currency TEXT NOT NULL DEFAULT 'MMK' CHECK(deposit_currency IN ('MMK', 'USDT')),
  usdt_network TEXT CHECK(usdt_network IS NULL OR usdt_network IN ('TRC20', 'BEP20')),
  kpay_transaction_id TEXT,
  txn_id TEXT,
  tx_hash TEXT,
  screenshot_path TEXT,
  screenshot_original_name TEXT,
  screenshot_mime_type TEXT,
  status TEXT DEFAULT 'PENDING' CHECK(status IN (
    'PENDING',
    'AWAITING_SCREENSHOT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'FAILED',
    'EXPIRED'
  )),
  purpose TEXT DEFAULT 'topup',
  metadata TEXT,
  user_note TEXT,
  admin_note TEXT,
  rejection_reason TEXT,
  reviewed_by_admin_id INTEGER,
  submitted_at TEXT,
  reviewed_at TEXT,
  verified_at TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO deposit_requests_v2_new (
  id, user_id, amount_mmk, amount_usd, ref_code, payment_method,
  deposit_currency, usdt_network, kpay_transaction_id, txn_id, tx_hash,
  screenshot_path, screenshot_original_name, screenshot_mime_type,
  status, purpose, metadata, user_note, admin_note, rejection_reason,
  reviewed_by_admin_id, submitted_at, reviewed_at, verified_at, expires_at,
  created_at, updated_at
)
SELECT
  id,
  user_id,
  amount_mmk,
  amount_usd,
  ref_code,
  payment_method,
  CASE
    WHEN purpose = 'usdt_topup' OR payment_method LIKE 'USDT%' THEN 'USDT'
    ELSE 'MMK'
  END,
  CASE
    WHEN payment_method = 'USDT-TRC20' THEN 'TRC20'
    WHEN payment_method = 'USDT-BEP20' THEN 'BEP20'
    ELSE NULL
  END,
  kpay_transaction_id,
  txn_id,
  txn_id,
  screenshot_path,
  screenshot_original_name,
  screenshot_mime_type,
  status,
  purpose,
  metadata,
  user_note,
  admin_note,
  rejection_reason,
  reviewed_by_admin_id,
  submitted_at,
  reviewed_at,
  verified_at,
  expires_at,
  created_at,
  updated_at
FROM deposit_requests_v2;

DROP TABLE deposit_requests_v2;

ALTER TABLE deposit_requests_v2_new RENAME TO deposit_requests_v2;

CREATE INDEX IF NOT EXISTS idx_deposits_v2_user ON deposit_requests_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_status ON deposit_requests_v2(status);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_ref ON deposit_requests_v2(ref_code);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_kpay_txn ON deposit_requests_v2(kpay_transaction_id);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_currency ON deposit_requests_v2(deposit_currency);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_tx_hash ON deposit_requests_v2(tx_hash);

CREATE VIEW pending_deposit_reviews AS
SELECT *
FROM deposit_requests_v2
WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');

PRAGMA foreign_keys = ON;
