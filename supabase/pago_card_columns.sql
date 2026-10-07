-- Pago Card columns for the synced card tables.
-- Run in the Supabase SQL Editor. This file is not applied automatically.
-- Safe to re-run: every column uses IF NOT EXISTS.
--
-- card_applications is the table the Express app syncs.
-- user_cards is the older card inventory table.
-- status stays the local lifecycle (pending, active, frozen, terminated, ...).
-- pago_status stores the raw provider status string.

ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS pago_card_id TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS pago_status TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS product_code TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS last_four TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS expiry_month TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS expiry_year TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS balance_display_usd NUMERIC(18, 4);
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS balance_amount BIGINT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS balance_currency TEXT;
ALTER TABLE card_applications ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_applications_pago_card_id
  ON card_applications (pago_card_id)
  WHERE pago_card_id IS NOT NULL;

ALTER TABLE card_reload_requests ADD COLUMN IF NOT EXISTS pago_card_id TEXT;
ALTER TABLE card_reload_requests ADD COLUMN IF NOT EXISTS pago_transaction_id TEXT;
ALTER TABLE card_reload_requests ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS pago_card_id TEXT;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS pago_status TEXT;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS product_code TEXT;
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cards_pago_card_id
  ON user_cards (pago_card_id)
  WHERE pago_card_id IS NOT NULL;
