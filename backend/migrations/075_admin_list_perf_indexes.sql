-- Faster admin list filters (status + recency)
CREATE INDEX IF NOT EXISTS idx_deposits_v2_status_created
  ON deposit_requests_v2 (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_status_created
  ON usdt_withdrawal_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mmk_withdrawals_status_created
  ON mmk_withdrawal_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_reload_requests_status_created
  ON card_reload_requests (status, created_at DESC);
