-- Allow admin dispute resolution statuses on P2P order tables

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS p2p_buy_orders__v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER REFERENCES p2p_sellers(id),
  ad_id INTEGER REFERENCES p2p_ads(id),
  maker_user_id INTEGER REFERENCES users(id),
  ref_code TEXT NOT NULL UNIQUE,
  amount_usdt REAL NOT NULL,
  amount_mmk REAL NOT NULL,
  price_mmk_per_usdt REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK(status IN (
      'pending_payment', 'pending_seller_release', 'released', 'cancelled', 'rejected',
      'completed_by_admin', 'cancelled_by_admin'
    )),
  mmk_transferred_at TEXT,
  released_at TEXT,
  rejected_at TEXT,
  admin_note TEXT,
  metadata TEXT,
  platform_fee_usdt REAL,
  net_usdt_to_buyer REAL,
  fee_percent_applied REAL,
  expires_at TEXT,
  dispute_status TEXT,
  dispute_reason TEXT,
  dispute_proof_path TEXT,
  disputed_at TEXT,
  auto_cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO p2p_buy_orders__v2 (
  id, user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
  price_mmk_per_usdt, payment_method, status, mmk_transferred_at, released_at, rejected_at,
  admin_note, metadata, platform_fee_usdt, net_usdt_to_buyer, fee_percent_applied,
  expires_at, dispute_status, dispute_reason, dispute_proof_path, disputed_at,
  auto_cancelled_at, created_at, updated_at
)
SELECT
  id, user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
  price_mmk_per_usdt, payment_method, status, mmk_transferred_at, released_at, rejected_at,
  admin_note, metadata, platform_fee_usdt, net_usdt_to_buyer, fee_percent_applied,
  expires_at, dispute_status, dispute_reason, dispute_proof_path, disputed_at,
  auto_cancelled_at, created_at, updated_at
FROM p2p_buy_orders;

DROP TABLE p2p_buy_orders;
ALTER TABLE p2p_buy_orders__v2 RENAME TO p2p_buy_orders;

CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_user ON p2p_buy_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_seller ON p2p_buy_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_status ON p2p_buy_orders(status);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_ref ON p2p_buy_orders(ref_code);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_expires ON p2p_buy_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_dispute ON p2p_buy_orders(dispute_status);

CREATE TABLE IF NOT EXISTS p2p_sell_orders__v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER REFERENCES p2p_sellers(id),
  ad_id INTEGER REFERENCES p2p_ads(id),
  maker_user_id INTEGER REFERENCES users(id),
  ref_code TEXT NOT NULL UNIQUE,
  amount_usdt REAL NOT NULL,
  amount_mmk REAL NOT NULL,
  price_mmk_per_usdt REAL NOT NULL,
  payment_method TEXT NOT NULL,
  user_payment_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_merchant_mmk'
    CHECK(status IN (
      'pending_merchant_mmk', 'released', 'cancelled', 'rejected',
      'completed_by_admin', 'cancelled_by_admin'
    )),
  usdt_escrowed_at TEXT,
  mmk_received_at TEXT,
  released_at TEXT,
  rejected_at TEXT,
  cancelled_at TEXT,
  platform_fee_usdt REAL,
  net_usdt_to_merchant REAL,
  fee_percent_applied REAL,
  admin_note TEXT,
  metadata TEXT,
  expires_at TEXT,
  dispute_status TEXT,
  dispute_reason TEXT,
  dispute_proof_path TEXT,
  disputed_at TEXT,
  auto_cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO p2p_sell_orders__v2 (
  id, user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
  price_mmk_per_usdt, payment_method, user_payment_account, status, usdt_escrowed_at,
  mmk_received_at, released_at, rejected_at, cancelled_at, platform_fee_usdt,
  net_usdt_to_merchant, fee_percent_applied, admin_note, metadata, expires_at,
  dispute_status, dispute_reason, dispute_proof_path, disputed_at, auto_cancelled_at,
  created_at, updated_at
)
SELECT
  id, user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
  price_mmk_per_usdt, payment_method, user_payment_account, status, usdt_escrowed_at,
  mmk_received_at, released_at, rejected_at, cancelled_at, platform_fee_usdt,
  net_usdt_to_merchant, fee_percent_applied, admin_note, metadata, expires_at,
  dispute_status, dispute_reason, dispute_proof_path, disputed_at, auto_cancelled_at,
  created_at, updated_at
FROM p2p_sell_orders;

DROP TABLE p2p_sell_orders;
ALTER TABLE p2p_sell_orders__v2 RENAME TO p2p_sell_orders;

CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_user ON p2p_sell_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_seller ON p2p_sell_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_status ON p2p_sell_orders(status);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_ref ON p2p_sell_orders(ref_code);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_expires ON p2p_sell_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_dispute ON p2p_sell_orders(dispute_status);

PRAGMA foreign_keys=ON;
