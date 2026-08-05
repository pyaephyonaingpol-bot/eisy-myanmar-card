-- P2P trading module: timers, disputes, chat, merchant online/escrow

ALTER TABLE p2p_buy_orders ADD COLUMN expires_at TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN dispute_status TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN dispute_reason TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN dispute_proof_path TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN disputed_at TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN auto_cancelled_at TEXT;

ALTER TABLE p2p_sell_orders ADD COLUMN expires_at TEXT;
ALTER TABLE p2p_sell_orders ADD COLUMN dispute_status TEXT;
ALTER TABLE p2p_sell_orders ADD COLUMN dispute_reason TEXT;
ALTER TABLE p2p_sell_orders ADD COLUMN dispute_proof_path TEXT;
ALTER TABLE p2p_sell_orders ADD COLUMN disputed_at TEXT;
ALTER TABLE p2p_sell_orders ADD COLUMN auto_cancelled_at TEXT;

ALTER TABLE p2p_sellers ADD COLUMN is_online INTEGER NOT NULL DEFAULT 1;
ALTER TABLE p2p_sellers ADD COLUMN escrow_balance_usdt REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS p2p_order_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type TEXT NOT NULL CHECK(order_type IN ('buy', 'sell')),
  order_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL CHECK(sender_role IN ('user', 'admin', 'system')),
  sender_user_id INTEGER,
  message TEXT,
  attachment_path TEXT,
  tx_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_p2p_order_messages_order ON p2p_order_messages(order_type, order_id);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_expires ON p2p_buy_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_expires ON p2p_sell_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_dispute ON p2p_buy_orders(dispute_status);
CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_dispute ON p2p_sell_orders(dispute_status);

UPDATE p2p_sellers SET is_online = 1 WHERE is_online IS NULL;
