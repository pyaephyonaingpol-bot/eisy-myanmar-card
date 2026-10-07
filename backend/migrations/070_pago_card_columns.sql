-- Pago Card identifiers on local cards_v2.
-- Existing rows keep provider NULL. New Pago issues set provider = 'pago'.

ALTER TABLE cards_v2 ADD COLUMN pago_card_id TEXT;
ALTER TABLE cards_v2 ADD COLUMN pago_status TEXT;
ALTER TABLE cards_v2 ADD COLUMN product_code TEXT;
ALTER TABLE cards_v2 ADD COLUMN brand TEXT;
ALTER TABLE cards_v2 ADD COLUMN last_four TEXT;
ALTER TABLE cards_v2 ADD COLUMN expiry_month TEXT;
ALTER TABLE cards_v2 ADD COLUMN expiry_year TEXT;
ALTER TABLE cards_v2 ADD COLUMN balance_display_usd REAL;
ALTER TABLE cards_v2 ADD COLUMN balance_amount INTEGER;
ALTER TABLE cards_v2 ADD COLUMN balance_currency TEXT;
ALTER TABLE cards_v2 ADD COLUMN provider TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_v2_pago_card_id
  ON cards_v2(pago_card_id)
  WHERE pago_card_id IS NOT NULL AND pago_card_id != '';
