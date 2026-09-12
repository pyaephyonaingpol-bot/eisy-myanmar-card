-- Dynamic funding fee (%) applied on initial card load at checkout.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('card_funding_fee_percent', '0', datetime('now'));
