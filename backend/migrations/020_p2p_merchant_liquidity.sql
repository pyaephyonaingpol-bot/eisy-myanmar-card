-- P2P merchant liquidity pool: escrow audit log + seed merchants

CREATE TABLE IF NOT EXISTS p2p_merchant_escrow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES p2p_sellers(id),
  direction TEXT NOT NULL CHECK(direction IN ('deposit', 'withdraw')),
  amount_usdt REAL NOT NULL,
  balance_after REAL NOT NULL,
  note TEXT,
  created_by TEXT DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_merchant_escrow_logs_seller ON p2p_merchant_escrow_logs(seller_id);

-- Activate demo sell-side merchant with liquidity
UPDATE p2p_sellers
SET status = 'active',
    is_online = 1,
    side = 'sell',
    price_mmk_per_usdt = 4500,
    payment_methods = '["KPay","WavePay","KBZ Bank"]',
    payment_accounts = '{"KPay":{"account_name":"Demo P2P Merchant","account_number":"09123456789"},"WavePay":{"account_name":"Demo P2P Merchant","account_number":"09987654321"},"KBZ Bank":{"account_name":"Demo P2P Merchant","account_number":"1234567890123","bank_name":"KBZ Bank"}}',
    escrow_balance_usdt = 5000,
    updated_at = datetime('now')
WHERE id = 1;

-- Seed sell-side merchants (users Buy USDT) — varied rates & payment rails
INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts, is_online, escrow_balance_usdt
) VALUES (
  5,
  'Yangon USDT Hub',
  'TRC20',
  'TYangonUSDTHubMerchantWallet123456789',
  'active',
  5,
  2000,
  4500,
  '["KPay","WavePay"]',
  'sell',
  '{"KPay":{"account_name":"Yangon USDT Hub","account_number":"09110001001"},"WavePay":{"account_name":"Yangon USDT Hub","account_number":"09910001001"}}',
  1,
  10000
);

INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts, is_online, escrow_balance_usdt
) VALUES (
  6,
  'Mandalay Crypto Exchange',
  'TRC20',
  'TMandalayCryptoExchangeWallet1234567',
  'active',
  10,
  3000,
  4520,
  '["WavePay","KBZ Bank"]',
  'sell',
  '{"WavePay":{"account_name":"Mandalay Crypto Exchange","account_number":"09220002002"},"KBZ Bank":{"account_name":"Mandalay Crypto Exchange","account_number":"2000200200202","bank_name":"KBZ Bank"}}',
  1,
  8500
);

INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts, is_online, escrow_balance_usdt
) VALUES (
  7,
  'AYA Digital Desk',
  'TRC20',
  'TAYADigitalDeskMerchantWallet123456789',
  'active',
  5,
  1500,
  4550,
  '["KPay","AYA Bank"]',
  'sell',
  '{"KPay":{"account_name":"AYA Digital Desk","account_number":"09330003003"},"AYA Bank":{"account_name":"AYA Digital Desk","account_number":"3000300300303","bank_name":"AYA Bank"}}',
  1,
  12000
);

INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts, is_online, escrow_balance_usdt
) VALUES (
  8,
  'Shwe USDT Express',
  'BEP20',
  '0xShweUSDTExpressMerchantWallet1234567890ab',
  'active',
  10,
  5000,
  4520,
  '["KPay","WavePay","KBZ Bank","AYA Bank"]',
  'sell',
  '{"KPay":{"account_name":"Shwe USDT Express","account_number":"09440004004"},"WavePay":{"account_name":"Shwe USDT Express","account_number":"09840004004"},"KBZ Bank":{"account_name":"Shwe USDT Express","account_number":"4000400400404","bank_name":"KBZ Bank"},"AYA Bank":{"account_name":"Shwe USDT Express","account_number":"5000500500505","bank_name":"AYA Bank"}}',
  1,
  7500
);

-- Top up buy-side merchants (users Sell USDT) with liquidity pools
UPDATE p2p_sellers SET escrow_balance_usdt = 6000, is_online = 1, updated_at = datetime('now') WHERE id = 2;
UPDATE p2p_sellers SET escrow_balance_usdt = 5500, is_online = 1, updated_at = datetime('now') WHERE id = 3;
UPDATE p2p_sellers SET escrow_balance_usdt = 7000, is_online = 1, updated_at = datetime('now') WHERE id = 4;
