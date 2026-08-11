-- Payment system: MMK bank withdrawals + USDT crypto/bank payout methods
-- Rules: no MMK→USDT exchange; MMK→bank OK; USDT→crypto OR USDT→MMK bank OK

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('minimum_mmk_withdrawal', '10000', datetime('now')),
  ('mmk_withdraw_fee_percent', '0', datetime('now')),
  ('usdt_withdraw_fee_bank', '1.0', datetime('now')),
  ('usdt_withdraw_fee_bank_type', 'fixed', datetime('now'));

CREATE TABLE IF NOT EXISTS mmk_withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_code TEXT UNIQUE NOT NULL,
  amount_mmk REAL NOT NULL,
  fee_mmk REAL NOT NULL DEFAULT 0,
  net_mmk REAL NOT NULL,
  fee_percent REAL NOT NULL DEFAULT 0,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending',
    'processing',
    'completed',
    'rejected',
    'cancelled'
  )),
  admin_note TEXT,
  processed_by INTEGER,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mmk_withdrawals_user ON mmk_withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_mmk_withdrawals_status ON mmk_withdrawal_requests(status);

-- Rebuild USDT withdrawals to support crypto wallet + bank (USDT→MMK) payouts
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS usdt_withdrawal_requests_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ref_code TEXT UNIQUE NOT NULL,
  payout_method TEXT NOT NULL DEFAULT 'crypto' CHECK(payout_method IN ('crypto', 'bank')),
  network TEXT,
  wallet_address TEXT,
  amount_usdt REAL NOT NULL,
  fee_usdt REAL NOT NULL,
  net_usdt REAL NOT NULL,
  fee_type TEXT NOT NULL DEFAULT 'fixed' CHECK(fee_type IN ('fixed', 'percent')),
  exchange_rate REAL,
  amount_mmk REAL,
  bank_name TEXT,
  account_name TEXT,
  account_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending',
    'processing',
    'completed',
    'rejected',
    'cancelled'
  )),
  admin_note TEXT,
  tx_hash TEXT,
  processed_by INTEGER,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO usdt_withdrawal_requests_v2 (
  id, user_id, ref_code, payout_method, network, wallet_address,
  amount_usdt, fee_usdt, net_usdt, fee_type,
  exchange_rate, amount_mmk, bank_name, account_name, account_number,
  status, admin_note, tx_hash, processed_by, processed_at, created_at, updated_at
)
SELECT
  id, user_id, ref_code, 'crypto', network, wallet_address,
  amount_usdt, fee_usdt, net_usdt, fee_type,
  NULL, NULL, NULL, NULL, NULL,
  status, admin_note, tx_hash, NULL, processed_at, created_at, updated_at
FROM usdt_withdrawal_requests;

DROP TABLE usdt_withdrawal_requests;
ALTER TABLE usdt_withdrawal_requests_v2 RENAME TO usdt_withdrawal_requests;

CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_user ON usdt_withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_status ON usdt_withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_method ON usdt_withdrawal_requests(payout_method);

PRAGMA foreign_keys=ON;
