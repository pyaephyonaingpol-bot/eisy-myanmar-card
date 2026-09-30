-- Kripicard Hub service purchases (SMS, SIM Top-Up, eSIM, Gift Cards, etc.)
CREATE TABLE IF NOT EXISTS kripicard_hub_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_price_usd REAL NOT NULL,
  processing_fee_usd REAL NOT NULL DEFAULT 1,
  total_charge_usd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  recipient_email TEXT,
  provider_payload TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_kripicard_hub_purchases_user
  ON kripicard_hub_purchases(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kripicard_hub_purchases_category
  ON kripicard_hub_purchases(category_id, created_at DESC);
