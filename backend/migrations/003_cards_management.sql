-- 003_cards_management.sql
-- Manual virtual card management: status, admin notes, multiple cards per user

CREATE TABLE IF NOT EXISTS cards_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_number TEXT NOT NULL,
  exp_date TEXT NOT NULL,
  cvv TEXT NOT NULL,
  card_holder_name TEXT NOT NULL,
  card_type TEXT DEFAULT 'virtual' CHECK(card_type IN ('virtual', 'physical')),
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'frozen', 'cancelled', 'expired')),
  is_primary INTEGER DEFAULT 0,
  issued_by_admin_id INTEGER,
  admin_notes TEXT,
  daily_limit_usd REAL,
  metadata TEXT,
  activated_at TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cards_v2_user ON cards_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_v2_status ON cards_v2(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_v2_primary ON cards_v2(user_id) WHERE is_primary = 1;

-- Migrate legacy cards table data if present
INSERT INTO cards_v2 (
  user_id, card_number, exp_date, cvv, card_holder_name,
  card_type, status, is_primary, created_at, updated_at, activated_at
)
SELECT
  user_id, card_number, exp_date, cvv, card_holder_name,
  'virtual', 'active', 1, created_at, created_at, created_at
FROM cards
WHERE NOT EXISTS (SELECT 1 FROM cards_v2 LIMIT 1);

-- Keep legacy table for backward compatibility; new code should use cards_v2
CREATE VIEW IF NOT EXISTS active_cards AS
SELECT * FROM cards_v2 WHERE status = 'active';
