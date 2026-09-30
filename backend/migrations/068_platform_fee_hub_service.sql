-- Allow Kripicard Hub service processing fees in platform_fee_events.
INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES ('platform_revenue_hub_service_usdt', '0', datetime('now'));

CREATE TABLE IF NOT EXISTS platform_fee_events__hub_068 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL CHECK(fee_type IN (
    'TYPE_P2P_FEE',
    'TYPE_CARD_RELOAD_FEE',
    'TYPE_CARD_ISSUE_FEE',
    'TYPE_WITHDRAWAL_FEE',
    'TYPE_DEPOSIT_FEE',
    'TYPE_HUB_SERVICE_FEE'
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

INSERT INTO platform_fee_events__hub_068 (
  id, fee_type, amount, currency, reference_type, reference_id,
  related_user_id, description, metadata, collected_at, created_by
)
SELECT
  id, fee_type, amount, currency, reference_type, reference_id,
  related_user_id, description, metadata, collected_at, created_by
FROM platform_fee_events;

DROP TABLE platform_fee_events;
ALTER TABLE platform_fee_events__hub_068 RENAME TO platform_fee_events;

CREATE INDEX IF NOT EXISTS idx_platform_fee_events_type ON platform_fee_events(fee_type, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_fee_events_ref ON platform_fee_events(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_events_user ON platform_fee_events(related_user_id);
