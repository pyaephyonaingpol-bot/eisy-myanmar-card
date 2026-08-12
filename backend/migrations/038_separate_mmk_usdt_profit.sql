-- Separate MMK vs USDT platform profit balances
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_mmk_revenue_balance', '0', datetime('now'));

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_revenue_card_reload_mmk', '0', datetime('now'));

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_revenue_card_issue_mmk', '0', datetime('now'));

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_revenue_deposit_mmk', '0', datetime('now'));

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_revenue_withdrawal_mmk', '0', datetime('now'));

-- Seed MMK revenue from existing MMK fee events (idempotent if balance still 0)
UPDATE app_settings
SET value = (
  SELECT CAST(COALESCE(SUM(amount), 0) AS INTEGER)
  FROM platform_fee_events
  WHERE UPPER(currency) = 'MMK'
),
updated_at = datetime('now')
WHERE key = 'platform_mmk_revenue_balance'
  AND (value IS NULL OR value = '' OR CAST(value AS REAL) = 0);
