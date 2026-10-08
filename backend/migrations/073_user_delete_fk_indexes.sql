-- Indexes for the columns the admin user-delete batch filters on.
-- user_id indexes already exist on the owning tables. These cover the
-- nullable foreign keys that are SET NULL, plus the legacy deposit table.

CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_maker_user
  ON p2p_buy_orders(maker_user_id);

CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_maker_user
  ON p2p_sell_orders(maker_user_id);

CREATE INDEX IF NOT EXISTS idx_p2p_buy_orders_ad
  ON p2p_buy_orders(ad_id);

CREATE INDEX IF NOT EXISTS idx_p2p_sell_orders_ad
  ON p2p_sell_orders(ad_id);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_user
  ON deposit_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_p2p_order_messages_sender
  ON p2p_order_messages(sender_user_id);
