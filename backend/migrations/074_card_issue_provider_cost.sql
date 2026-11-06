-- Provider cost subtracted from the card issuing fee when reporting net profit.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('card_issue_provider_cost_usd', '1.50', datetime('now'));
