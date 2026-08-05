-- P2P market listing fields (price, payment methods, buy/sell side)

ALTER TABLE p2p_sellers ADD COLUMN price_mmk_per_usdt REAL;
ALTER TABLE p2p_sellers ADD COLUMN payment_methods TEXT DEFAULT '["KPay","WavePay","Bank Transfer"]';
ALTER TABLE p2p_sellers ADD COLUMN side TEXT NOT NULL DEFAULT 'sell' CHECK(side IN ('sell', 'buy'));

UPDATE p2p_sellers
SET payment_methods = '["KPay","WavePay","Bank Transfer"]',
    side = 'sell',
    price_mmk_per_usdt = 4550,
    status = 'active'
WHERE id = 1;
