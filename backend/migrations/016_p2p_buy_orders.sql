-- P2P Buy USDT orders (MMK payment → USDT wallet credit via escrow)

ALTER TABLE p2p_sellers ADD COLUMN payment_accounts TEXT;

CREATE TABLE IF NOT EXISTS p2p_buy_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES p2p_sellers(id),
  ref_code TEXT NOT NULL UNIQUE,
  amount_usdt REAL NOT NULL,
  amount_mmk REAL NOT NULL,
  price_mmk_per_usdt REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK(status IN ('pending_payment', 'pending_seller_release', 'released', 'cancelled', 'rejected')),
  mmk_transferred_at TEXT,
  released_at TEXT,
  rejected_at TEXT,
  admin_note TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_user ON p2p_buy_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_seller ON p2p_buy_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_status ON p2p_buy_orders(status);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_ref ON p2p_buy_orders(ref_code);

UPDATE p2p_sellers
SET payment_accounts = '{"KPay":{"account_name":"Demo P2P Merchant","account_number":"09123456789"},"WavePay":{"account_name":"Demo P2P Merchant","account_number":"09987654321"},"Bank Transfer":{"account_name":"Demo P2P Merchant","account_number":"1234567890123","bank_name":"KBZ Bank"}}'
WHERE id = 1 AND (payment_accounts IS NULL OR payment_accounts = '');
