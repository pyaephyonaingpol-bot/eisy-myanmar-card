-- Optional MMK cash float (bank / payment accounts). When set, withdrawable MMK
-- profit = cash_float − user MMK liabilities − pending MMK withdrawal nets.
-- Leave empty to use accounting pool (liabilities + booked MMK fee revenue).
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_mmk_cash_float', '', datetime('now'));
