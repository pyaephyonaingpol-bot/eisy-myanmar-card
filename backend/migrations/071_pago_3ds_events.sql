-- Pagocards 3DS OTP / verification events (webhook intake).
-- Deduplicate on event_id. OTPs are short-lived; expires_at defaults to +15 minutes.

CREATE TABLE IF NOT EXISTS pago_3ds_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT '3ds',
  auth_id TEXT,
  otp TEXT,
  pago_card_id TEXT,
  local_card_id INTEGER,
  user_id INTEGER,
  merchant_name TEXT,
  transaction_amount TEXT,
  transaction_currency TEXT,
  verification_type TEXT,
  user_bankcard_id TEXT,
  raw_payload TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT,
  expires_at TEXT,
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_pago_3ds_events_user_received
  ON pago_3ds_events(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_pago_3ds_events_card_received
  ON pago_3ds_events(local_card_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_pago_3ds_events_pago_card
  ON pago_3ds_events(pago_card_id);
