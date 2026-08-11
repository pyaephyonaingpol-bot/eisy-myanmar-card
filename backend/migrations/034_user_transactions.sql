-- Unified payment Transactions ledger + optional username on users.
-- User:      id, email/username, balance (default 0), createdAt, updatedAt
-- Transaction: id, userId, type deposit|withdraw, amount, currency USDT,
--              status pending|completed|rejected, txId, createdAt

-- Optional username (login/display alias alongside email)
ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (username)
  WHERE username IS NOT NULL AND TRIM(username) != '';

-- Payment transactions (deposit / withdraw)
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USDT' CHECK (currency = 'USDT'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'rejected')),
  tx_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_id_unique
  ON transactions (tx_id)
  WHERE tx_id IS NOT NULL AND TRIM(tx_id) != '';
