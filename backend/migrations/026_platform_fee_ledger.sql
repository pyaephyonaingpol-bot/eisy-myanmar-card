-- Platform fee ledger: categorized revenue events (P2P, card reload, withdrawal, card issue)

CREATE TABLE IF NOT EXISTS platform_fee_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL CHECK(fee_type IN (
    'TYPE_P2P_FEE',
    'TYPE_CARD_RELOAD_FEE',
    'TYPE_CARD_ISSUE_FEE',
    'TYPE_WITHDRAWAL_FEE'
  )),
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('USDT', 'USD')),
  reference_type TEXT,
  reference_id INTEGER,
  related_user_id INTEGER,
  description TEXT,
  metadata TEXT,
  collected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT DEFAULT 'system',
  FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_fee_events_type ON platform_fee_events(fee_type, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_fee_events_ref ON platform_fee_events(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_events_user ON platform_fee_events(related_user_id);

-- Backfill P2P buy order fees
INSERT INTO platform_fee_events (
  fee_type, amount, currency, reference_type, reference_id, related_user_id,
  description, collected_at, created_by
)
SELECT
  'TYPE_P2P_FEE',
  platform_fee_usdt,
  'USDT',
  'p2p_buy_orders',
  id,
  user_id,
  'P2P buy platform fee — ' || ref_code,
  COALESCE(released_at, updated_at, created_at),
  'system'
FROM p2p_buy_orders
WHERE status = 'released'
  AND COALESCE(platform_fee_usdt, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM platform_fee_events pfe
    WHERE pfe.reference_type = 'p2p_buy_orders' AND pfe.reference_id = p2p_buy_orders.id
  );

-- Backfill P2P sell order fees
INSERT INTO platform_fee_events (
  fee_type, amount, currency, reference_type, reference_id, related_user_id,
  description, collected_at, created_by
)
SELECT
  'TYPE_P2P_FEE',
  platform_fee_usdt,
  'USDT',
  'p2p_sell_orders',
  id,
  user_id,
  'P2P sell platform fee — ' || ref_code,
  COALESCE(released_at, updated_at, created_at),
  'system'
FROM p2p_sell_orders
WHERE status = 'released'
  AND COALESCE(platform_fee_usdt, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM platform_fee_events pfe
    WHERE pfe.reference_type = 'p2p_sell_orders' AND pfe.reference_id = p2p_sell_orders.id
  );

-- Backfill card reload fees
INSERT INTO platform_fee_events (
  fee_type, amount, currency, reference_type, reference_id, related_user_id,
  description, collected_at, created_by
)
SELECT
  'TYPE_CARD_RELOAD_FEE',
  reload_fee_usd,
  'USD',
  'card_reload_requests',
  id,
  user_id,
  'Card reload fee — RELOAD-' || id,
  COALESCE(reviewed_at, updated_at, created_at),
  COALESCE(reviewed_by, 'system')
FROM card_reload_requests
WHERE status = 'approved'
  AND COALESCE(reload_fee_usd, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM platform_fee_events pfe
    WHERE pfe.reference_type = 'card_reload_requests' AND pfe.reference_id = card_reload_requests.id
  );

-- Backfill withdrawal fees
INSERT INTO platform_fee_events (
  fee_type, amount, currency, reference_type, reference_id, related_user_id,
  description, metadata, collected_at, created_by
)
SELECT
  'TYPE_WITHDRAWAL_FEE',
  fee_usdt,
  'USDT',
  'usdt_withdrawal_requests',
  id,
  user_id,
  'USDT withdrawal fee — ' || ref_code,
  json_object('network', network, 'ref_code', ref_code),
  created_at,
  'system'
FROM usdt_withdrawal_requests
WHERE COALESCE(fee_usdt, 0) > 0
  AND status NOT IN ('cancelled', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM platform_fee_events pfe
    WHERE pfe.reference_type = 'usdt_withdrawal_requests' AND pfe.reference_id = usdt_withdrawal_requests.id
  );

-- Initialize categorized sub-balance settings from backfilled ledger
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('platform_revenue_p2p_usdt', '0', datetime('now')),
  ('platform_revenue_withdrawal_usdt', '0', datetime('now')),
  ('platform_revenue_card_reload_usd', '0', datetime('now')),
  ('platform_revenue_card_issue_usd', '0', datetime('now'));

UPDATE app_settings SET value = (
  SELECT COALESCE(SUM(amount), 0) FROM platform_fee_events WHERE fee_type = 'TYPE_P2P_FEE'
), updated_at = datetime('now') WHERE key = 'platform_revenue_p2p_usdt';

UPDATE app_settings SET value = (
  SELECT COALESCE(SUM(amount), 0) FROM platform_fee_events WHERE fee_type = 'TYPE_WITHDRAWAL_FEE'
), updated_at = datetime('now') WHERE key = 'platform_revenue_withdrawal_usdt';

UPDATE app_settings SET value = (
  SELECT COALESCE(SUM(amount), 0) FROM platform_fee_events WHERE fee_type = 'TYPE_CARD_RELOAD_FEE'
), updated_at = datetime('now') WHERE key = 'platform_revenue_card_reload_usd';

UPDATE app_settings SET value = (
  SELECT COALESCE(SUM(amount), 0) FROM platform_fee_events WHERE fee_type = 'TYPE_CARD_ISSUE_FEE'
), updated_at = datetime('now') WHERE key = 'platform_revenue_card_issue_usd';
