-- P2P seller platform fee (deducted from seller side on order release)

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('p2p_seller_fee_percent', '1.0');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('platform_usdt_revenue_balance', '0');

ALTER TABLE p2p_buy_orders ADD COLUMN platform_fee_usdt REAL;
ALTER TABLE p2p_buy_orders ADD COLUMN net_usdt_to_buyer REAL;
ALTER TABLE p2p_buy_orders ADD COLUMN fee_percent_applied REAL;
