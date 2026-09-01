-- Supabase mirror: USDT-only deposits/reloads; MMK reserved for withdrawals.
-- Run after schema.sql on existing projects.

ALTER TABLE deposit_requests
  ALTER COLUMN deposit_currency SET DEFAULT 'USDT';

UPDATE deposit_requests
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"legacy_mmk_deposit": true}'::jsonb
WHERE deposit_currency = 'MMK';

UPDATE deposit_requests
SET deposit_currency = 'USDT'
WHERE deposit_currency IS DISTINCT FROM 'USDT';

ALTER TABLE card_reload_requests
  ALTER COLUMN wallet_type SET DEFAULT 'usdt';

UPDATE card_reload_requests
SET pricing = COALESCE(pricing, '{}'::jsonb)
  || jsonb_build_object('legacy_mmk_reload', true, 'legacy_wallet_type', wallet_type)
WHERE wallet_type = 'mmk';

UPDATE card_reload_requests
SET wallet_type = 'usdt'
WHERE wallet_type IS DISTINCT FROM 'usdt';

-- Optional hard constraints for new writes (legacy rows already normalized above)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deposit_requests_currency_usdt_only'
  ) THEN
    ALTER TABLE deposit_requests
      ADD CONSTRAINT deposit_requests_currency_usdt_only
      CHECK (deposit_currency = 'USDT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'card_reload_wallet_type_usdt_only'
  ) THEN
    ALTER TABLE card_reload_requests
      ADD CONSTRAINT card_reload_wallet_type_usdt_only
      CHECK (wallet_type = 'usdt');
  END IF;
END $$;
