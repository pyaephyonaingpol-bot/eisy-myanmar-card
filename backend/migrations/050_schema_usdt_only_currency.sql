-- Tighten deposit/reload currency enums to USDT-only.
-- Legacy MMK deposit/reload rows are tagged in metadata/pricing_json before rebuild.
-- MMK remains on withdrawal tables (mmk_withdrawal_requests, usdt_withdrawal_requests.amount_mmk).

PRAGMA foreign_keys = OFF;

DROP VIEW IF EXISTS pending_deposit_reviews;

-- Tag legacy MMK deposits before currency enum cleanup
UPDATE deposit_requests_v2
SET metadata = json_set(COALESCE(metadata, '{}'), '$.legacy_mmk_deposit', 1)
WHERE deposit_currency = 'MMK';

UPDATE card_reload_requests
SET pricing_json = json_set(
  json_set(COALESCE(pricing_json, '{}'), '$.legacy_mmk_reload', 1),
  '$.legacy_wallet_type', wallet_type
)
WHERE wallet_type = 'mmk';

CREATE TABLE deposit_requests_v2_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_mmk REAL NOT NULL DEFAULT 0,
  amount_usd REAL NOT NULL,
  ref_code TEXT UNIQUE NOT NULL,
  payment_method TEXT DEFAULT 'USDT-TRC20',
  deposit_currency TEXT NOT NULL DEFAULT 'USDT' CHECK(deposit_currency IN ('USDT')),
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
  platform_profit_usd REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO deposit_requests_v2_new (
  id, user_id, amount_mmk, amount_usd, ref_code, payment_method,
  deposit_currency, usdt_network, kpay_transaction_id, txn_id, tx_hash,
  screenshot_path, screenshot_original_name, screenshot_mime_type,
  status, purpose, metadata, user_note, admin_note, rejection_reason,
  reviewed_by_admin_id, submitted_at, reviewed_at, verified_at, expires_at,
  created_at, updated_at, platform_profit_usd
)
SELECT
  id, user_id, amount_mmk, amount_usd, ref_code, payment_method,
  'USDT',
  usdt_network, kpay_transaction_id, txn_id, tx_hash,
  screenshot_path, screenshot_original_name, screenshot_mime_type,
  status, purpose, metadata, user_note, admin_note, rejection_reason,
  reviewed_by_admin_id, submitted_at, reviewed_at, verified_at, expires_at,
  created_at, updated_at, platform_profit_usd
FROM deposit_requests_v2;

DROP TABLE deposit_requests_v2;
ALTER TABLE deposit_requests_v2_new RENAME TO deposit_requests_v2;

CREATE INDEX IF NOT EXISTS idx_deposits_v2_user ON deposit_requests_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_status ON deposit_requests_v2(status);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_ref ON deposit_requests_v2(ref_code);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_kpay_txn ON deposit_requests_v2(kpay_transaction_id);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_currency ON deposit_requests_v2(deposit_currency);
CREATE INDEX IF NOT EXISTS idx_deposits_v2_tx_hash ON deposit_requests_v2(tx_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_v2_tx_hash_unique
  ON deposit_requests_v2(tx_hash) WHERE tx_hash IS NOT NULL AND tx_hash != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_v2_txn_id_unique
  ON deposit_requests_v2(txn_id) WHERE txn_id IS NOT NULL AND txn_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_v2_kpay_txn_unique
  ON deposit_requests_v2(kpay_transaction_id) WHERE kpay_transaction_id IS NOT NULL AND kpay_transaction_id != '';

CREATE TABLE card_reload_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  wallet_type TEXT NOT NULL DEFAULT 'usdt' CHECK(wallet_type IN ('usdt')),
  amount_mmk REAL,
  amount_usdt REAL,
  net_usd_to_card REAL NOT NULL,
  reload_fee_usd REAL,
  gross_usd REAL,
  pricing_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  deposit_id INTEGER,
  user_note TEXT,
  admin_note TEXT,
  rejection_reason TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (card_id) REFERENCES cards_v2(id)
);

INSERT INTO card_reload_requests_new (
  id, user_id, card_id, wallet_type, amount_mmk, amount_usdt,
  net_usd_to_card, reload_fee_usd, gross_usd, pricing_json,
  status, deposit_id, user_note, admin_note, rejection_reason,
  reviewed_at, reviewed_by, created_at, updated_at
)
SELECT
  id, user_id, card_id, 'usdt', amount_mmk, amount_usdt,
  net_usd_to_card, reload_fee_usd, gross_usd, pricing_json,
  status, deposit_id, user_note, admin_note, rejection_reason,
  reviewed_at, reviewed_by, created_at, updated_at
FROM card_reload_requests;

DROP TABLE card_reload_requests;
ALTER TABLE card_reload_requests_new RENAME TO card_reload_requests;

CREATE INDEX IF NOT EXISTS idx_card_reload_requests_status ON card_reload_requests(status);
CREATE INDEX IF NOT EXISTS idx_card_reload_requests_user ON card_reload_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_card_reload_requests_card ON card_reload_requests(card_id);

CREATE VIEW pending_deposit_reviews AS
SELECT *
FROM deposit_requests_v2
WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');

-- Deprecated MMK reload minimum (reloads are USDT-only)
DELETE FROM app_settings WHERE key = 'minimum_card_reload_mmk';

-- Defense-in-depth triggers (049 may have been dropped with table rebuild)
DROP TRIGGER IF EXISTS trg_card_reload_reject_mmk_insert;
DROP TRIGGER IF EXISTS trg_card_reload_reject_mmk_update;
DROP TRIGGER IF EXISTS trg_deposit_reject_mmk_insert;

CREATE TRIGGER trg_card_reload_reject_mmk_insert
BEFORE INSERT ON card_reload_requests
FOR EACH ROW
WHEN NEW.wallet_type != 'usdt'
BEGIN
  SELECT RAISE(ABORT, 'USDT_ONLY_CARD_RELOAD: card reload wallet_type must be usdt');
END;

CREATE TRIGGER trg_deposit_reject_mmk_insert
BEFORE INSERT ON deposit_requests_v2
FOR EACH ROW
WHEN NEW.deposit_currency != 'USDT'
BEGIN
  SELECT RAISE(ABORT, 'USDT_ONLY_DEPOSIT: deposit_currency must be USDT');
END;

PRAGMA foreign_keys = ON;
