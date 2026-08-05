-- User-to-user P2P ads (C2C marketplace)

CREATE TABLE IF NOT EXISTS p2p_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  side TEXT NOT NULL CHECK(side IN ('sell', 'buy')),
  network TEXT NOT NULL DEFAULT 'TRC20',
  price_mmk_per_usdt REAL NOT NULL,
  total_volume_usdt REAL NOT NULL,
  available_volume_usdt REAL NOT NULL,
  min_order_usdt REAL NOT NULL DEFAULT 5,
  max_order_usdt REAL NOT NULL DEFAULT 1000,
  payment_methods TEXT NOT NULL DEFAULT '["KPay","WavePay"]',
  payment_accounts TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled', 'closed')),
  escrow_locked_usdt REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_ads_user ON p2p_ads(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_ads_market ON p2p_ads(status, side, network);

ALTER TABLE p2p_buy_orders ADD COLUMN ad_id INTEGER REFERENCES p2p_ads(id);
ALTER TABLE p2p_buy_orders ADD COLUMN maker_user_id INTEGER REFERENCES users(id);

ALTER TABLE p2p_sell_orders ADD COLUMN ad_id INTEGER REFERENCES p2p_ads(id);
ALTER TABLE p2p_sell_orders ADD COLUMN maker_user_id INTEGER REFERENCES users(id);
