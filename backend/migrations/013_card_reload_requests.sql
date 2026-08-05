-- Pending wallet-paid card reload requests (admin approve / reject with refund)

CREATE TABLE IF NOT EXISTS card_reload_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  wallet_type TEXT NOT NULL CHECK(wallet_type IN ('mmk', 'usdt')),
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

CREATE INDEX IF NOT EXISTS idx_card_reload_requests_status ON card_reload_requests(status);
CREATE INDEX IF NOT EXISTS idx_card_reload_requests_user ON card_reload_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_card_reload_requests_card ON card_reload_requests(card_id);
