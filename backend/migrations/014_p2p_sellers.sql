-- P2P USDT sellers for merchant deposit channel

CREATE TABLE IF NOT EXISTS p2p_sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('TRC20', 'BEP20')),
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  qr_code_url TEXT,
  min_deposit REAL NOT NULL DEFAULT 5,
  max_deposit REAL NOT NULL DEFAULT 10000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_sellers_status ON p2p_sellers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_sellers_network ON p2p_sellers(network);

-- Demo seller (inactive by default until admin activates)
INSERT OR IGNORE INTO p2p_sellers (id, name, network, wallet_address, status, min_deposit, max_deposit)
VALUES (
  1,
  'Demo P2P Merchant',
  'TRC20',
  'TDemoP2PMerchantWalletAddress123456789',
  'inactive',
  5,
  5000
);
