-- Kripicard payment-collection events (Master Wallet / Instant Card funding).
-- Webhook intake records each event once; successful pays credit users.balance_usdt.

CREATE TABLE IF NOT EXISTS kripicard_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  collection_id TEXT,
  payment_id TEXT,
  merchant_reference TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deposit_id INTEGER,
  amount_usdt REAL,
  currency TEXT DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'received',
  credited INTEGER NOT NULL DEFAULT 0,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  credited_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_kripicard_payment_events_collection
  ON kripicard_payment_events(collection_id);

CREATE INDEX IF NOT EXISTS idx_kripicard_payment_events_merchant_ref
  ON kripicard_payment_events(merchant_reference);

CREATE INDEX IF NOT EXISTS idx_kripicard_payment_events_user
  ON kripicard_payment_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kripicard_payment_events_deposit
  ON kripicard_payment_events(deposit_id);
