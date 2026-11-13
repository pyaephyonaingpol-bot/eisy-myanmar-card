-- =============================================================================
-- Eisy Myanmar — EMERGENCY Supabase RLS lockdown (strict)
-- =============================================================================
-- Run in Supabase SQL Editor ASAP if anon/authenticated clients can read or
-- write other users' rows.
--
-- Goals:
--   1) ENABLE ROW LEVEL SECURITY on every public app table.
--   2) Drop open / mis-scoped policies (especially "service_role_*" policies that
--      omitted `TO service_role` and therefore applied to anon + authenticated).
--   3) Authenticated users: SELECT (and limited profile UPDATE) of OWN rows only
--      via auth.uid()::text = user_id (no auth_user_id column required).
--   4) Anon: NO table DML on app data (Google OAuth still uses Auth APIs only).
--   5) service_role: full access for Express / Edge (SUPABASE_SERVICE_ROLE_KEY).
--
-- Safe to re-run. Does NOT require / create user_wallets.auth_user_id.
-- Does NOT touch storage.objects (avoids ERROR 42501 must be owner of table objects).
-- Configure Storage RLS in the Supabase Dashboard → Storage settings instead.
-- =============================================================================

-- ─── Ensure core tables exist (no-op if already applied) ─────────────────────
-- Do not ADD auth_user_id — many live projects only have user_id.
-- Own-row policies use inline user_id::text = auth.uid()::text (no helper fn).
CREATE TABLE IF NOT EXISTS public.user_wallets (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  balance_mmk NUMERIC(18, 2) NOT NULL DEFAULT 0,
  balance_usdt NUMERIC(18, 4) NOT NULL DEFAULT 0,
  tron_deposit_address TEXT,
  tron_derivation_index INTEGER,
  tron_derivation_path TEXT,
  auth_status TEXT NOT NULL DEFAULT 'active',
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  amount_mmk NUMERIC(18, 2) DEFAULT 0,
  amount_usd NUMERIC(18, 4) DEFAULT 0,
  ref_code TEXT,
  payment_method TEXT,
  deposit_currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'PENDING',
  purpose TEXT DEFAULT 'topup',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.card_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  card_holder_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  display_status TEXT DEFAULT 'PENDING_ISSUANCE',
  pricing JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  deposit_id TEXT,
  pago_card_id TEXT,
  pago_status TEXT,
  product_code TEXT,
  brand TEXT,
  last_four TEXT,
  expiry_month TEXT,
  expiry_year TEXT,
  currency TEXT DEFAULT 'USD',
  balance_display_usd NUMERIC(18, 4),
  balance_amount BIGINT,
  balance_currency TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.card_reload_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  card_id TEXT,
  wallet_type TEXT NOT NULL DEFAULT 'usdt',
  amount_mmk NUMERIC(18, 2),
  amount_usdt NUMERIC(18, 4),
  net_usd_to_card NUMERIC(18, 4),
  status TEXT NOT NULL DEFAULT 'pending',
  pricing JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  pago_card_id TEXT,
  pago_transaction_id TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE,
  user_id BIGINT,
  local_deposit_id BIGINT,
  ref_code TEXT,
  amount NUMERIC(18, 8) NOT NULL,
  deposit_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  tx_hash TEXT,
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transaction_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,
  direction TEXT,
  amount_usd NUMERIC(18, 4),
  amount_mmk NUMERIC(18, 2),
  amount_usdt NUMERIC(18, 4),
  balance_before NUMERIC(18, 4),
  balance_after NUMERIC(18, 4),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usdt_withdrawal_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ref_code TEXT,
  payout_method TEXT,
  network TEXT,
  wallet_address TEXT,
  amount_usdt NUMERIC(18, 4),
  fee_usdt NUMERIC(18, 4),
  net_usdt NUMERIC(18, 4),
  status TEXT,
  tx_hash TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.usdt_bank_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_name TEXT,
  ref_code TEXT,
  payout_method TEXT DEFAULT 'bank',
  amount_usdt NUMERIC,
  fee_usdt NUMERIC,
  net_usdt NUMERIC,
  exchange_rate NUMERIC,
  amount_mmk NUMERIC,
  bank_name TEXT,
  account_name TEXT,
  account_number TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_usdt NUMERIC(18, 4) NOT NULL,
  balance_before NUMERIC(18, 4),
  balance_after NUMERIC(18, 4),
  status TEXT NOT NULL DEFAULT 'pending',
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_journal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usdt_scan_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  destination_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  amount_usdt NUMERIC(18, 4) NOT NULL,
  fee_usdt NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_debit_usdt NUMERIC(18, 4) NOT NULL,
  qr_payload TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  payout_status TEXT NOT NULL DEFAULT 'pending',
  payout_tx_hash TEXT,
  journal_id TEXT,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_tron_hd_addresses (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL,
  derivation_path TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_tron_deposit_addresses (
  user_id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL,
  derivation_path TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_threads (
  id BIGINT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  user_name TEXT,
  subject TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  last_message_preview TEXT,
  unread_by_admin INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id BIGINT PRIMARY KEY,
  thread_id BIGINT NOT NULL,
  user_id TEXT,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  message TEXT NOT NULL,
  source TEXT DEFAULT 'web',
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- card_pools / user_cards are created by supabase/card_pools.sql — do not stub them here.

-- ─── Enable RLS on every known public table ──────────────────────────────────
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
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ─── Revoke default client privileges on app tables ──────────────────────────
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
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      -- Authenticated may SELECT; RLS still filters to own rows.
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
      -- Profiles may update own row (policy-gated).
      IF t = 'profiles' THEN
        EXECUTE format('GRANT UPDATE ON TABLE public.%I TO authenticated', t);
      END IF;
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- ─── Drop known dangerous / legacy policies ──────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        policyname ILIKE 'anon_all_%'
        OR policyname ILIKE '%anon_all%'
        OR policyname IN (
          'authenticated_select_support_messages',
          'service_role_card_pools',
          'service_role_user_cards',
          'service_role_wallet_transactions',
          'service_role_user_tron_hd_addresses',
          'service_role_user_tron_deposit_addresses',
          'service_role_orders',
          'service_role_user_wallets',
          'service_role_deposit_requests',
          'service_role_card_applications',
          'service_role_card_reload_requests',
          'service_role_transaction_logs',
          'service_role_usdt_withdrawal_requests',
          'service_role_all_support_messages',
          'service_role_all_support_threads',
          'profiles_select_own',
          'profiles_update_own',
          'profiles_insert_own'
        )
        OR policyname ILIKE 'authenticated_%'
        OR policyname ILIKE 'own_%'
        OR policyname ILIKE 'users_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Extra explicit drops (idempotent) for historical names
DROP POLICY IF EXISTS "anon_all_user_wallets" ON public.user_wallets;
DROP POLICY IF EXISTS "anon_all_deposit_requests" ON public.deposit_requests;
DROP POLICY IF EXISTS "anon_all_card_applications" ON public.card_applications;
DROP POLICY IF EXISTS "anon_all_card_reload_requests" ON public.card_reload_requests;

-- ─── service_role policies (EXPLICIT TO service_role) ────────────────────────
CREATE POLICY "service_role_all_user_wallets"
  ON public.user_wallets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_deposit_requests"
  ON public.deposit_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_card_applications"
  ON public.card_applications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_card_reload_requests"
  ON public.card_reload_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_orders"
  ON public.orders FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_transaction_logs"
  ON public.transaction_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_usdt_withdrawal_requests"
  ON public.usdt_withdrawal_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_usdt_bank_withdrawals"
  ON public.usdt_bank_withdrawals FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_wallet_transactions"
  ON public.wallet_transactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_usdt_scan_payments"
  ON public.usdt_scan_payments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_user_tron_hd_addresses"
  ON public.user_tron_hd_addresses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_user_tron_deposit_addresses"
  ON public.user_tron_deposit_addresses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_support_threads"
  ON public.support_threads FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_support_messages"
  ON public.support_messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_profiles"
  ON public.profiles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF to_regclass('public.card_pools') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "service_role_all_card_pools"
        ON public.card_pools FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$;
  END IF;
  IF to_regclass('public.user_cards') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "service_role_all_user_cards"
        ON public.user_cards FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ─── Authenticated: own-row SELECT only (inline auth.uid — no helper fn) ─────
-- Owner check: user_id::text = auth.uid()::text (works for text or bigint user_id).
CREATE POLICY "authenticated_select_own_user_wallets"
  ON public.user_wallets FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_deposit_requests"
  ON public.deposit_requests FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_card_applications"
  ON public.card_applications FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_card_reload_requests"
  ON public.card_reload_requests FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_orders"
  ON public.orders FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_transaction_logs"
  ON public.transaction_logs FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_usdt_withdrawal_requests"
  ON public.usdt_withdrawal_requests FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_usdt_bank_withdrawals"
  ON public.usdt_bank_withdrawals FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_wallet_transactions"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_usdt_scan_payments"
  ON public.usdt_scan_payments FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_user_tron_hd_addresses"
  ON public.user_tron_hd_addresses FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_user_tron_deposit_addresses"
  ON public.user_tron_deposit_addresses FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_support_threads"
  ON public.support_threads FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text);

CREATE POLICY "authenticated_select_own_support_messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text)
    OR EXISTS (
      SELECT 1 FROM public.support_threads t
      WHERE t.id = support_messages.thread_id
        AND t.user_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND t.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "authenticated_select_own_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = id);

CREATE POLICY "authenticated_update_own_profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_cards' AND column_name = 'user_id'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated_select_own_user_cards"
        ON public.user_cards FOR SELECT TO authenticated
        USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text)
    $p$;
  END IF;
END $$;

-- card_pools: inventory — no authenticated/anon access (service_role only)
-- anon: intentionally no policies on any of the above tables

-- Drop leftover helpers from earlier lockdown attempts (after policies that
-- may have depended on them were replaced above).
DROP FUNCTION IF EXISTS public.is_own_wallet_row(text, text);
DROP FUNCTION IF EXISTS public.is_own_user_id(text);
DROP FUNCTION IF EXISTS public.is_own_user(text);
DROP FUNCTION IF EXISTS public.is_own_user();

-- ─── SECURITY DEFINER RPCs: service_role only ────────────────────────────────
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'assign_card_from_pool',
        'debit_usdt_for_card_purchase',
        'finalize_card_purchase_wallet',
        'debit_usdt_for_scan_pay'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

-- Storage RLS is intentionally omitted here (storage.objects is owned by
-- Supabase; ALTER/POLICY from the SQL Editor often fails with 42501).
-- Set bucket policies in Dashboard → Storage, or run supabase/upload_storage.sql
-- only if your role can own/manage storage.objects.

-- ─── Verification helpers (read-only) ────────────────────────────────────────
-- After apply, run:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
--   SELECT tablename, policyname, roles, cmd, qual
--     FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
-- Expect: no anon policies on money tables; authenticated quals use auth.uid() / user_id.
