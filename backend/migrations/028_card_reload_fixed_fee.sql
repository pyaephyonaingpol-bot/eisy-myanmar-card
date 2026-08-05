-- Fixed card reload fee defaults ($3.50 user fee, $2.00 net platform profit)
UPDATE app_settings SET value = '3.50', updated_at = datetime('now') WHERE key = 'card_reload_fee_usd';
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('card_reload_fee_usd', '3.50', datetime('now'));
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('card_reload_provider_cost_usd', '1.50', datetime('now'));
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('card_reload_net_profit_usd', '2.00', datetime('now'));
