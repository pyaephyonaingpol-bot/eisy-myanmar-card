-- 006_transaction_logs.sql
-- Immutable transaction / activity audit log

CREATE TABLE IF NOT EXISTS transaction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'deposit_request',
    'deposit_verified',
    'deposit_rejected',
    'balance_credit',
    'balance_debit',
    'card_issued',
    'card_frozen',
    'card_cancelled',
    'card_updated',
    'login',
    'logout',
    'pin_set',
    'pin_reset',
    'otp_sent',
    'otp_verified',
    'biometric_registered',
    'support_message',
    'admin_adjustment',
    'other'
  )),
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
  created_by TEXT DEFAULT 'system' CHECK(created_by IN ('system', 'user', 'admin', 'listener')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_user ON transaction_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_type ON transaction_logs(type);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_reference ON transaction_logs(reference_type, reference_id);
