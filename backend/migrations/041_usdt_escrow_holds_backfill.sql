-- Re-backfill missing usdt_escrow_holds for active P2P sell ads and pending sell orders.
-- Safe to run multiple times (INSERT OR IGNORE).

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
  AND pa.status IN ('active', 'closed')
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
