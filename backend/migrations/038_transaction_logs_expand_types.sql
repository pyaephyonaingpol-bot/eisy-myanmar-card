-- Expand transaction_logs.type CHECK to include KYC + other types used by the app.
-- SQLite cannot ALTER CHECK constraints in place — rebuild the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS transaction_logs__v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    -- Original (006)
    'deposit_request',
    'deposit_verified',
    'deposit_rejected',
    'deposit_review',
    'balance_credit',
    'balance_debit',
    'card_issued',
    'card_frozen',
    'card_cancelled',
    'card_updated',
    'card_request',
    'card_topup',
    'card_transaction',
    'login',
    'logout',
    'pin_set',
    'pin_reset',
    'otp_sent',
    'otp_verified',
    'biometric_registered',
    'password_changed',
    'support_message',
    'admin_adjustment',
    'other',
    -- KYC
    'kyc_submitted',
    'kyc_approved',
    'kyc_verified',
    'kyc_rejected',
    -- Admin auth / RBAC
    'admin_login',
    'admin_bootstrap',
    'admin_role_assigned',
    'admin_role_updated',
    'admin_role_removed',
    'admin_password_set',
    -- P2P / escrow / transfers
    'p2p_ad_created',
    'p2p_ad_cancelled',
    'p2p_buy_order',
    'p2p_buy_order_release',
    'p2p_buy_order_rejected',
    'p2p_sell_order',
    'p2p_sell_order_release',
    'p2p_sell_order_cancelled',
    'p2p_sell_order_rejected',
    'p2p_merchant_escrow_deposit',
    'p2p_merchant_escrow_withdraw',
    'p2p_merchant_escrow_release',
    'p2p_merchant_escrow_credit',
    'escrow_lock',
    'escrow_refund',
    'escrow_release',
    'escrow_receive',
    'internal_transfer_out',
    'internal_transfer_in'
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
  created_by TEXT DEFAULT 'system' CHECK(created_by IN (
    'system',
    'user',
    'admin',
    'listener',
    'blockchain',
    'binance_pay',
    'test-bypass',
    'tron-indexer'
  )),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Remap any legacy/unknown values so the INSERT cannot fail the new CHECKs.
INSERT INTO transaction_logs__v2 (
  id, user_id, type, direction, amount_usd, amount_mmk,
  balance_before, balance_after, reference_type, reference_id,
  description, metadata, ip_address, created_by, created_at
)
SELECT
  id,
  user_id,
  CASE type
    WHEN 'deposit_request' THEN type
    WHEN 'deposit_verified' THEN type
    WHEN 'deposit_rejected' THEN type
    WHEN 'deposit_review' THEN type
    WHEN 'balance_credit' THEN type
    WHEN 'balance_debit' THEN type
    WHEN 'card_issued' THEN type
    WHEN 'card_frozen' THEN type
    WHEN 'card_cancelled' THEN type
    WHEN 'card_updated' THEN type
    WHEN 'card_request' THEN type
    WHEN 'card_topup' THEN type
    WHEN 'card_transaction' THEN type
    WHEN 'login' THEN type
    WHEN 'logout' THEN type
    WHEN 'pin_set' THEN type
    WHEN 'pin_reset' THEN type
    WHEN 'otp_sent' THEN type
    WHEN 'otp_verified' THEN type
    WHEN 'biometric_registered' THEN type
    WHEN 'password_changed' THEN type
    WHEN 'support_message' THEN type
    WHEN 'admin_adjustment' THEN type
    WHEN 'other' THEN type
    WHEN 'kyc_submitted' THEN type
    WHEN 'kyc_approved' THEN type
    WHEN 'kyc_verified' THEN type
    WHEN 'kyc_rejected' THEN type
    WHEN 'admin_login' THEN type
    WHEN 'admin_bootstrap' THEN type
    WHEN 'admin_role_assigned' THEN type
    WHEN 'admin_role_updated' THEN type
    WHEN 'admin_role_removed' THEN type
    WHEN 'admin_password_set' THEN type
    WHEN 'p2p_ad_created' THEN type
    WHEN 'p2p_ad_cancelled' THEN type
    WHEN 'p2p_buy_order' THEN type
    WHEN 'p2p_buy_order_release' THEN type
    WHEN 'p2p_buy_order_rejected' THEN type
    WHEN 'p2p_sell_order' THEN type
    WHEN 'p2p_sell_order_release' THEN type
    WHEN 'p2p_sell_order_cancelled' THEN type
    WHEN 'p2p_sell_order_rejected' THEN type
    WHEN 'p2p_merchant_escrow_deposit' THEN type
    WHEN 'p2p_merchant_escrow_withdraw' THEN type
    WHEN 'p2p_merchant_escrow_release' THEN type
    WHEN 'p2p_merchant_escrow_credit' THEN type
    WHEN 'escrow_lock' THEN type
    WHEN 'escrow_refund' THEN type
    WHEN 'escrow_release' THEN type
    WHEN 'escrow_receive' THEN type
    WHEN 'internal_transfer_out' THEN type
    WHEN 'internal_transfer_in' THEN type
    ELSE 'other'
  END,
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
    ELSE 'system'
  END,
  created_at
FROM transaction_logs;

DROP TABLE transaction_logs;
ALTER TABLE transaction_logs__v2 RENAME TO transaction_logs;

CREATE INDEX IF NOT EXISTS idx_transaction_logs_user ON transaction_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_type ON transaction_logs(type);
CREATE INDEX IF NOT EXISTS idx_transaction_logs_reference ON transaction_logs(reference_type, reference_id);

PRAGMA foreign_keys=ON;
