-- Internal USDT ledger: available vs locked balances, escrow holds, peer transfers.

ALTER TABLE users ADD COLUMN balance_usdt_locked REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS usdt_escrow_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usdt REAL NOT NULL,
  remaining_usdt REAL NOT NULL,
  hold_type TEXT NOT NULL CHECK(hold_type IN ('p2p_ad', 'p2p_sell_order', 'withdrawal', 'internal_transfer')),
  reference_type TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'consumed', 'refunded', 'cancelled')),
  journal_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT,
  UNIQUE(reference_type, reference_id, hold_type)
);

CREATE INDEX IF NOT EXISTS idx_usdt_escrow_holds_user_status
  ON usdt_escrow_holds(user_id, status);

CREATE TABLE IF NOT EXISTS usdt_internal_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT UNIQUE,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usdt REAL NOT NULL,
  fee_usdt REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT,
  journal_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usdt_internal_transfers_from
  ON usdt_internal_transfers(from_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_internal_transfers_to
  ON usdt_internal_transfers(to_user_id, created_at DESC);

-- Extend wallet transaction audit trail
ALTER TABLE usdt_wallet_transactions ADD COLUMN balance_before REAL;
ALTER TABLE usdt_wallet_transactions ADD COLUMN locked_balance_after REAL;
ALTER TABLE usdt_wallet_transactions ADD COLUMN journal_id TEXT;
ALTER TABLE usdt_wallet_transactions ADD COLUMN counterparty_user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_usdt_wallet_tx_journal
  ON usdt_wallet_transactions(journal_id);

-- Backfill locked balance from existing implicit P2P escrow (available already reduced).
UPDATE users SET balance_usdt_locked = (
  SELECT COALESCE(SUM(pa.escrow_locked_usdt), 0)
  FROM p2p_ads pa
  WHERE pa.user_id = users.id
    AND pa.side = 'sell'
    AND pa.status = 'active'
    AND pa.escrow_locked_usdt > 0
) + (
  SELECT COALESCE(SUM(so.amount_usdt), 0)
  FROM p2p_sell_orders so
  WHERE so.user_id = users.id
    AND so.status IN ('pending_merchant_mmk', 'disputed')
);

INSERT OR IGNORE INTO usdt_escrow_holds (
  user_id, amount_usdt, remaining_usdt, hold_type, reference_type, reference_id, status, created_at
)
SELECT
  pa.user_id,
  pa.escrow_locked_usdt,
  pa.escrow_locked_usdt,
  'p2p_ad',
  'p2p_ads',
  pa.id,
  'active',
  datetime('now')
FROM p2p_ads pa
WHERE pa.side = 'sell'
  AND pa.status = 'active'
  AND pa.escrow_locked_usdt > 0;

INSERT OR IGNORE INTO usdt_escrow_holds (
  user_id, amount_usdt, remaining_usdt, hold_type, reference_type, reference_id, status, created_at
)
SELECT
  so.user_id,
  so.amount_usdt,
  so.amount_usdt,
  'p2p_sell_order',
  'p2p_sell_orders',
  so.id,
  'active',
  datetime('now')
FROM p2p_sell_orders so
WHERE so.status IN ('pending_merchant_mmk', 'disputed');
