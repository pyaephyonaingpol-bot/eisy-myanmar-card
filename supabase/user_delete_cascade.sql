-- =============================================================================
-- Eisy Myanmar — single-round-trip purge of a user's Supabase mirror rows
-- =============================================================================
-- Run in the Supabase SQL Editor (service_role / postgres).
--
-- Express admin delete calls:
--   rpc('admin_purge_user_mirror', { p_user_id: '<turso user id>' })
-- so mirror cleanup is ONE Postgres round trip instead of N table DELETEs
-- (which was blowing the Vercel gateway and returning HTTP 504).
--
-- Safe to re-run. Tables that do not exist are skipped.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_purge_user_mirror(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  n bigint;
  t text;
  tables text[] := ARRAY[
    'support_messages',
    'support_threads',
    'user_cards',
    'card_pools',
    'card_reload_requests',
    'card_applications',
    'deposit_requests',
    'transaction_logs',
    'wallet_transactions',
    'usdt_withdrawal_requests',
    'usdt_bank_withdrawals',
    'usdt_scan_payments',
    'user_tron_hd_addresses',
    'user_tron_deposit_addresses',
    'orders',
    'user_wallets'
  ];
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  -- Prefer service_role JWT; allow postgres owner for SQL Editor tests.
  IF coalesce(auth.role(), '') NOT IN ('service_role', 'postgres')
     AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'admin_purge_user_mirror requires service_role';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      result := result || jsonb_build_object(t, jsonb_build_object('skipped', true));
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE user_id::text = $1', t)
        USING trim(p_user_id);
      GET DIAGNOSTICS n = ROW_COUNT;
      result := result || jsonb_build_object(t, jsonb_build_object('deleted', n));
    EXCEPTION
      WHEN undefined_column THEN
        -- orders.user_id may be bigint; still cast via ::text above. Other shapes: skip.
        result := result || jsonb_build_object(t, jsonb_build_object('skipped', true, 'reason', 'no_user_id'));
      WHEN OTHERS THEN
        result := result || jsonb_build_object(
          t,
          jsonb_build_object('error', SQLERRM)
        );
    END;
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user_mirror(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_user_mirror(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_purge_user_mirror(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_mirror(text) TO service_role;

COMMENT ON FUNCTION public.admin_purge_user_mirror(text) IS
  'Bulk-delete Supabase mirror rows for one user_id (admin delete). service_role only.';
