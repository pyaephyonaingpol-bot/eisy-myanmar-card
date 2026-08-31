-- Separate deposit vs withdrawal service fee settings (independent mode / % / fixed).

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'deposit_service_fee_mode', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_mode';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'deposit_service_fee_percent', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_percent';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'deposit_service_fee_minimum_usdt', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_minimum_usdt';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'withdrawal_service_fee_mode', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_mode';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'withdrawal_service_fee_percent', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_percent';

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
SELECT 'withdrawal_service_fee_minimum_usdt', value, datetime('now')
FROM app_settings WHERE key = 'payment_service_fee_minimum_usdt';

-- Defaults when legacy unified keys were never set
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('deposit_service_fee_mode', 'max_percent_or_min', datetime('now')),
  ('deposit_service_fee_percent', '2', datetime('now')),
  ('deposit_service_fee_minimum_usdt', '1', datetime('now')),
  ('withdrawal_service_fee_mode', 'max_percent_or_min', datetime('now')),
  ('withdrawal_service_fee_percent', '2', datetime('now')),
  ('withdrawal_service_fee_minimum_usdt', '1', datetime('now'));
