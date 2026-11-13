-- =============================================================================
-- Eisy Myanmar — reaffirm service_role access after strict RLS lockdown
-- =============================================================================
-- Safe to re-run in the Supabase SQL Editor.
--
-- Express admin APIs use SUPABASE_SERVICE_ROLE_KEY (role = service_role).
-- FORCE ROW LEVEL SECURITY does NOT block service_role when that role has
-- BYPASSRLS (Supabase default). These grants + policies make that explicit so
-- admin directory / wallet / support sync cannot lose table access after a
-- lockdown script that revoked PUBLIC / anon / authenticated privileges.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO service_role;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'user_wallets',
    'deposit_requests',
    'card_applications',
    'card_reload_requests',
    'orders',
    'transaction_logs',
    'usdt_withdrawal_requests',
    'usdt_bank_withdrawals',
    'wallet_transactions',
    'usdt_scan_payments',
    'user_tron_hd_addresses',
    'user_tron_deposit_addresses',
    'support_threads',
    'support_messages',
    'profiles',
    'card_pools',
    'user_cards'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
      -- Ensure an explicit service_role policy exists (FORCE RLS + no BYPASS edge cases).
      BEGIN
        EXECUTE format(
          'CREATE POLICY service_role_all_%I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          t, t
        );
      EXCEPTION
        WHEN duplicate_object THEN
          NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- Sequences used by identity columns (if any)
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.%I TO service_role', s.sequence_schema, s.sequence_name);
  END LOOP;
END $$;
