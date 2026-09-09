-- Speed up USDT ledger / internal-transfer lookups.
-- Note: users.email expression index is created in applyUserAuthColumns
-- (email is added by that patch after SQL migrations).

CREATE INDEX IF NOT EXISTS idx_usdt_wallet_tx_user_ref
  ON usdt_wallet_transactions (user_id, reference_type, reference_id, tx_type);

CREATE INDEX IF NOT EXISTS idx_usdt_internal_transfers_created
  ON usdt_internal_transfers (created_at DESC);

-- username is added in 034; expression index speeds peer lookup by username.
CREATE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (LOWER(TRIM(username)));
