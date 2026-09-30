-- Kripicard withdrawal markup: 4% (3% network + 1% platform), percent mode.
-- Processing SLA is 48 hours (application copy + metadata; not encoded in SQL).

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('withdrawal_service_fee_percent', '4', datetime('now')),
  ('withdrawal_service_fee_minimum_usdt', '0', datetime('now')),
  ('withdrawal_service_fee_mode', 'percent', datetime('now')),
  ('payment_service_fee_percent', '4', datetime('now')),
  ('payment_service_fee_minimum_usdt', '0', datetime('now')),
  ('payment_service_fee_mode', 'percent', datetime('now')),
  ('usdt_withdraw_fee_trc20', '4', datetime('now')),
  ('usdt_withdraw_fee_trc20_type', 'percent', datetime('now')),
  ('usdt_withdraw_fee_bep20', '4', datetime('now')),
  ('usdt_withdraw_fee_bep20_type', 'percent', datetime('now')),
  ('usdt_withdraw_fee_bank', '4', datetime('now')),
  ('usdt_withdraw_fee_bank_type', 'percent', datetime('now')),
  ('mmk_withdraw_fee_percent', '4', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = datetime('now');
