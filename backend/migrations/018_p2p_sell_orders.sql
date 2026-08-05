-- P2P Sell USDT orders (USDT wallet escrow → external MMK payout)

CREATE TABLE IF NOT EXISTS p2p_sell_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES p2p_sellers(id),
  ref_code TEXT NOT NULL UNIQUE,
  amount_usdt REAL NOT NULL,
  amount_mmk REAL NOT NULL,
  price_mmk_per_usdt REAL NOT NULL,
  payment_method TEXT NOT NULL,
  user_payment_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_merchant_mmk'
    CHECK(status IN ('pending_merchant_mmk', 'released', 'cancelled', 'rejected')),
  usdt_escrowed_at TEXT,
  mmk_received_at TEXT,
  released_at TEXT,
  rejected_at TEXT,
  cancelled_at TEXT,
  platform_fee_usdt REAL,
  net_usdt_to_merchant REAL,
  fee_percent_applied REAL,
  admin_note TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_user ON p2p_sell_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_seller ON p2p_sell_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_status ON p2p_sell_orders(status);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_ref ON p2p_sell_orders(ref_code);

-- Demo merchants for Sell USDT tab (merchants who buy USDT from users)
INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts
) VALUES (
  2,
  'Eisy Verified Merchant',
  'TRC20',
  'TEisyVerifiedMerchantWallet1234567890',
  'active',
  10,
  1000,
  4500,
  '["KPay","WavePay","KBZ Bank"]',
  'buy',
  '{"KPay":{"account_name":"Eisy Verified Merchant","account_number":"09111222333"},"WavePay":{"account_name":"Eisy Verified Merchant","account_number":"09988777666"},"KBZ Bank":{"account_name":"Eisy Verified Merchant","account_number":"4567890123456","bank_name":"KBZ Bank"}}'
);

INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts
) VALUES (
  3,
  'Golden MMK Exchange',
  'TRC20',
  'TGoldenMMKExchangeWallet12345678901',
  'active',
  10,
  1000,
  4480,
  '["KPay","WavePay","KBZ Bank"]',
  'buy',
  '{"KPay":{"account_name":"Golden MMK Exchange","account_number":"09222333444"},"WavePay":{"account_name":"Golden MMK Exchange","account_number":"09877665544"},"KBZ Bank":{"account_name":"Golden MMK Exchange","account_number":"5678901234567","bank_name":"KBZ Bank"}}'
);

INSERT OR IGNORE INTO p2p_sellers (
  id, name, network, wallet_address, status, min_deposit, max_deposit,
  price_mmk_per_usdt, payment_methods, side, payment_accounts
) VALUES (
  4,
  'Swift USDT Buyer',
  'BEP20',
  '0xSwiftUSDTBuyerWallet1234567890abcdef',
  'active',
  10,
  1000,
  4520,
  '["KPay","WavePay","KBZ Bank"]',
  'buy',
  '{"KPay":{"account_name":"Swift USDT Buyer","account_number":"09333444555"},"WavePay":{"account_name":"Swift USDT Buyer","account_number":"09766554433"},"KBZ Bank":{"account_name":"Swift USDT Buyer","account_number":"6789012345678","bank_name":"KBZ Bank"}}'
);
