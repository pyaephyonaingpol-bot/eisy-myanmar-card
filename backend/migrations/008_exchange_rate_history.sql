-- 008_exchange_rate_history.sql
-- Daily exchange rate & pricing history for audit and deposit rate linking

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_at TEXT NOT NULL,
  mmk_to_usd_rate REAL NOT NULL,
  card_issuance_fee_usd REAL NOT NULL,
  minimum_initial_deposit_usd REAL,
  updated_by TEXT DEFAULT 'admin',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_history_effective ON exchange_rate_history(effective_at DESC);

INSERT INTO exchange_rate_history (
  effective_at, mmk_to_usd_rate, card_issuance_fee_usd, minimum_initial_deposit_usd, updated_by, notes
)
SELECT
  datetime('now'),
  CAST(COALESCE((SELECT value FROM app_settings WHERE key = 'mmk_to_usd_rate'), '4500') AS REAL),
  CAST(COALESCE((SELECT value FROM app_settings WHERE key = 'card_issuance_fee_usd'), '5.00') AS REAL),
  CAST(COALESCE((SELECT value FROM app_settings WHERE key = 'minimum_initial_deposit_usd'), '10.00') AS REAL),
  'system',
  'Initial rate from app settings'
WHERE NOT EXISTS (SELECT 1 FROM exchange_rate_history LIMIT 1);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('rate_effective_date', date('now'));
