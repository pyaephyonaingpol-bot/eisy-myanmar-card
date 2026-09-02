-- List all users with wallet / TRON deposit addresses (Supabase mirror)
-- Run in Supabase → SQL Editor
--
-- Note: The authoritative user registry is Turso/LibSQL (`users` table).
-- Supabase stores mirrors in `user_wallets` (+ optional `profiles`, `user_tron_deposit_addresses`).
-- If you see fewer than 19 rows here, run backend/scripts/list-all-users-with-wallets.js against Turso.

-- Quick count
SELECT COUNT(*) AS user_wallet_rows FROM public.user_wallets;
SELECT COUNT(*) AS profile_rows FROM public.profiles;

-- Full list: one row per user with balances + TRON deposit address(es)
SELECT
  uw.user_id AS id,
  COALESCE(uw.name, p.full_name) AS name,
  COALESCE(uw.email, p.email) AS email,
  p.phone,
  uw.balance_usdt,
  uw.balance_mmk,
  uw.tron_deposit_address,
  uw.tron_derivation_index,
  uw.tron_derivation_path,
  utda.address AS tron_hd_table_address,
  utda.derivation_path AS tron_hd_table_path,
  uw.updated_at AS wallet_updated_at,
  p.created_at AS profile_created_at
FROM public.user_wallets uw
LEFT JOIN public.profiles p
  ON p.id::text = uw.user_id
  OR (p.email IS NOT NULL AND lower(p.email) = lower(uw.email))
LEFT JOIN public.user_tron_deposit_addresses utda
  ON utda.user_id = uw.user_id
ORDER BY
  CASE WHEN uw.user_id ~ '^[0-9]+$' THEN uw.user_id::bigint ELSE NULL END NULLS LAST,
  uw.user_id;

-- Compact view (best for scanning all 19 users)
SELECT
  uw.user_id AS id,
  COALESCE(uw.name, p.full_name, '(no name)') AS name,
  COALESCE(uw.email, p.email, '(no email)') AS email,
  COALESCE(uw.tron_deposit_address, utda.address, '(no tron address)') AS tron_deposit_address,
  uw.balance_usdt,
  uw.balance_mmk
FROM public.user_wallets uw
LEFT JOIN public.profiles p ON p.id::text = uw.user_id
LEFT JOIN public.user_tron_deposit_addresses utda ON utda.user_id = uw.user_id
ORDER BY
  CASE WHEN uw.user_id ~ '^[0-9]+$' THEN uw.user_id::bigint ELSE NULL END;
