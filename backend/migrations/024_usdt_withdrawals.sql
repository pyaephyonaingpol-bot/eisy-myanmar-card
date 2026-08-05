-- USDT withdrawal fee settings (app_settings) and withdrawal request ledger

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('usdt_withdraw_fee_trc20', '1.5', datetime('now')),
  ('usdt_withdraw_fee_bep20', '0.8', datetime('now')),
  ('usdt_withdraw_fee_trc20_type', 'fixed', datetime('now')),
  ('usdt_withdraw_fee_bep20_type', 'fixed', datetime('now')),
  ('minimum_usdt_withdrawal', '10', datetime('now'));

CREATE TABLE IF NOT EXISTS usdt_withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_code TEXT UNIQUE NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('TRC20', 'BEP20')),
  wallet_address TEXT NOT NULL,
  amount_usdt REAL NOT NULL,
  fee_usdt REAL NOT NULL,
  net_usdt REAL NOT NULL,
  fee_type TEXT NOT NULL DEFAULT 'fixed' CHECK(fee_type IN ('fixed', 'percent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending',
    'processing',
    'completed',
    'rejected',
    'cancelled'
  )),
  admin_note TEXT,
  tx_hash TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_user ON usdt_withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_status ON usdt_withdrawal_requests(status);
