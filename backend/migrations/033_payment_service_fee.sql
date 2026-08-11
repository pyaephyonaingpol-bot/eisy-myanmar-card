-- Unified payment service fee: 2% with minimum $1 (Math.max(amount * 0.02, 1))
-- Applies to Deposit and Withdrawal

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('payment_service_fee_percent', '2', datetime('now')),
  ('payment_service_fee_minimum_usdt', '1', datetime('now'));

-- Align legacy withdrawal fee knobs with the new policy (percent 2%, min covered by calculator)
UPDATE app_settings SET value = '2', updated_at = datetime('now') WHERE key IN (
  'usdt_withdraw_fee_trc20',
  'usdt_withdraw_fee_bep20',
  'usdt_withdraw_fee_bank',
  'mmk_withdraw_fee_percent',
  'payment_service_fee_percent'
);
UPDATE app_settings SET value = 'percent', updated_at = datetime('now') WHERE key IN (
  'usdt_withdraw_fee_trc20_type',
  'usdt_withdraw_fee_bep20_type',
  'usdt_withdraw_fee_bank_type'
);
UPDATE app_settings SET value = '1', updated_at = datetime('now')
  WHERE key = 'payment_service_fee_minimum_usdt';
