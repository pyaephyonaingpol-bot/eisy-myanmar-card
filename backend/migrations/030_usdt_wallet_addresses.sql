-- Per-user USDT wallet addresses (custodial deposit refs + linked external wallets)
-- and dedicated USDT wallet transaction history.

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('usdt_erc20_address', '', datetime('now'));

CREATE TABLE IF NOT EXISTS user_usdt_wallet_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network TEXT NOT NULL CHECK(network IN ('TRC20', 'BEP20', 'ERC20')),
  address TEXT NOT NULL,
  address_type TEXT NOT NULL DEFAULT 'custodial' CHECK(address_type IN ('custodial', 'linked')),
  deposit_reference TEXT,
  label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, network, address_type, address)
);

CREATE INDEX IF NOT EXISTS idx_user_usdt_wallet_addr_user
  ON user_usdt_wallet_addresses(user_id);

CREATE INDEX IF NOT EXISTS idx_user_usdt_wallet_addr_ref
  ON user_usdt_wallet_addresses(deposit_reference);

CREATE TABLE IF NOT EXISTS usdt_wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network TEXT,
  tx_type TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'neutral' CHECK(direction IN ('credit', 'debit', 'neutral')),
  amount_usdt REAL NOT NULL DEFAULT 0,
  balance_after REAL,
  tx_hash TEXT,
  counterparty_address TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  reference_type TEXT,
  reference_id INTEGER,
  description TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usdt_wallet_tx_user_created
  ON usdt_wallet_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_wallet_tx_hash
  ON usdt_wallet_transactions(tx_hash);
