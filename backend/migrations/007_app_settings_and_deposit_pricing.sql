-- 007_app_settings_and_deposit_pricing.sql
-- Admin-configurable card pricing and deposit metadata for card issuance payments

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('card_issuance_fee_usd', '5.00');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('minimum_initial_deposit_usd', '10.00');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('mmk_to_usd_rate', '4500');

ALTER TABLE deposit_requests_v2 ADD COLUMN purpose TEXT DEFAULT 'topup';
ALTER TABLE deposit_requests_v2 ADD COLUMN metadata TEXT;
