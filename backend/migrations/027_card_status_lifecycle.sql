-- Extend card lifecycle statuses: suspended, terminated + status_reason audit field

PRAGMA foreign_keys=OFF;

DROP VIEW IF EXISTS active_cards;

CREATE TABLE IF NOT EXISTS cards_v2__v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_number TEXT NOT NULL,
  exp_date TEXT NOT NULL,
  cvv TEXT NOT NULL,
  card_holder_name TEXT NOT NULL,
  card_type TEXT DEFAULT 'virtual' CHECK(card_type IN ('virtual', 'physical')),
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending', 'active', 'suspended', 'frozen', 'terminated', 'cancelled', 'expired'
  )),
  is_primary INTEGER DEFAULT 0,
  issued_by_admin_id INTEGER,
  admin_notes TEXT,
  daily_limit_usd REAL,
  metadata TEXT,
  activated_at TEXT,
  cancelled_at TEXT,
  suspended_at TEXT,
  status_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO cards_v2__v2 (
  id, user_id, card_number, exp_date, cvv, card_holder_name,
  card_type, currency, status, is_primary, issued_by_admin_id, admin_notes,
  daily_limit_usd, metadata, activated_at, cancelled_at, suspended_at, status_reason,
  created_at, updated_at
)
SELECT
  id, user_id, card_number, exp_date, cvv, card_holder_name,
  card_type, currency,
  CASE
    WHEN status IN ('cancelled', 'expired') THEN 'terminated'
    ELSE status
  END,
  is_primary, issued_by_admin_id, admin_notes,
  daily_limit_usd, metadata, activated_at, cancelled_at, NULL, NULL,
  created_at, updated_at
FROM cards_v2;

DROP TABLE cards_v2;
ALTER TABLE cards_v2__v2 RENAME TO cards_v2;

CREATE INDEX IF NOT EXISTS idx_cards_v2_user ON cards_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_v2_status ON cards_v2(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_v2_primary ON cards_v2(user_id) WHERE is_primary = 1;

CREATE VIEW IF NOT EXISTS active_cards AS
SELECT * FROM cards_v2 WHERE status = 'active';

PRAGMA foreign_keys=ON;
