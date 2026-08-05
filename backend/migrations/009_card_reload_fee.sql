-- Card reload / top-up service fee (USD deducted from converted deposit)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('card_reload_fee_usd', '1.00');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('minimum_card_reload_mmk', '10000');
