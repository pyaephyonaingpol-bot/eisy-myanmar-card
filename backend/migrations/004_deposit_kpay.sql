-- 004_deposit_kpay.sql
-- KPay deposits with screenshot upload and transaction ID review workflow

CREATE TABLE IF NOT EXISTS deposit_requests_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_mmk REAL NOT NULL,
  amount_usd REAL NOT NULL,
  ref_code TEXT UNIQUE NOT NULL,
  payment_method TEXT DEFAULT 'KBZPay' CHECK(payment_method IN ('KBZPay', 'WavePay', 'KPay', 'Other')),
  kpay_transaction_id TEXT,
  txn_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_deposits_v2_user ON deposit_requests_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_status ON deposit_requests_v2(status);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_ref ON deposit_requests_v2(ref_code);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_kpay_txn ON deposit_requests_v2(kpay_transaction_id);

INSERT INTO deposit_requests_v2 (
  user_id, amount_mmk, amount_usd, ref_code, payment_method,
  txn_id, status, created_at, updated_at,
  verified_at
)
SELECT
  user_id, amount_mmk, amount_usd, ref_code, COALESCE(payment_method, 'KBZPay'),
  txn_id,
  CASE
    WHEN status = 'VERIFIED' THEN 'VERIFIED'
    WHEN status = 'FAILED' THEN 'FAILED'
    ELSE 'PENDING'
  END,
  created_at, created_at,
  CASE WHEN status = 'VERIFIED' THEN created_at ELSE NULL END
FROM deposit_requests
WHERE NOT EXISTS (SELECT 1 FROM deposit_requests_v2 LIMIT 1);

CREATE VIEW IF NOT EXISTS pending_deposit_reviews AS
SELECT *
FROM deposit_requests_v2
WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');
