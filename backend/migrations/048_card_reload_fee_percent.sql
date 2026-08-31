-- Card reload fee as a configurable percentage of top-up amount.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('card_reload_fee_percent', '0', datetime('now'));
