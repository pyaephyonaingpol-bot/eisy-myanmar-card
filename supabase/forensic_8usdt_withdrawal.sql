-- =============================================================================
-- Forensic: attribute the ~8 USDT TRC20 withdrawal (Tronscan hash 15e187bd8db…)
-- Paste into Supabase → SQL Editor → Run
--
-- NOTE: The live Express ledger is Turso/LibSQL (`usdt_withdrawal_requests`,
-- `transaction_logs`, `users`). Supabase only has mirrors if dual-write ran
-- and `supabase/security_rls_lockdown.sql` (or equivalent) was applied.
-- If these queries return empty, run the Turso script instead:
--   node backend/scripts/forensic-withdraw-lookup.js --hash 15e187bd8db --dest TDcbAK59 --user 16
-- =============================================================================

-- 0) What tables exist?
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name ILIKE '%withdraw%'
    OR table_name ILIKE '%transaction%'
    OR table_name ILIKE '%admin%log%'
    OR table_name ILIKE '%user_wallet%'
    OR table_name = 'users'
    OR table_name = 'profiles'
  )
ORDER BY table_name;

-- 1) Withdrawal rows matching hash / destination / ~8 USDT
SELECT
  w.*,
  uw.email AS wallet_email,
  uw.name AS wallet_name,
  p.email AS profile_email,
  p.full_name AS profile_name
FROM public.usdt_withdrawal_requests w
LEFT JOIN public.user_wallets uw ON uw.user_id = w.user_id::text
LEFT JOIN public.profiles p ON p.id::text = w.user_id::text
WHERE
  lower(coalesce(w.tx_hash, '')) LIKE '15e187bd8db%'
  OR coalesce(w.wallet_address, '') ILIKE 'TDcbAK59%'
  OR w.net_usdt BETWEEN 7.5 AND 8.5
  OR w.amount_usdt BETWEEN 7.5 AND 10.5
ORDER BY w.created_at DESC NULLS LAST
LIMIT 100;

-- 2) Bank withdrawal mirror (~8 USDT)
SELECT *
FROM public.usdt_bank_withdrawals
WHERE
  amount_usdt BETWEEN 7.5 AND 10.5
  OR net_usdt BETWEEN 7.5 AND 8.5
  OR coalesce(admin_note, '') ILIKE '%15e187%'
  OR coalesce(user_email, '') ILIKE '%talha%'
ORDER BY created_at DESC
LIMIT 50;

-- 3) Ledger / transaction_logs mentioning hash, dest, or withdraw around 8 USDT
SELECT *
FROM public.transaction_logs
WHERE
  lower(coalesce(description, '')) LIKE '%15e187bd8db%'
  OR lower(coalesce(description, '')) LIKE '%tdcbak59%'
  OR lower(coalesce(metadata::text, '')) LIKE '%15e187bd8db%'
  OR lower(coalesce(metadata::text, '')) LIKE '%tdcbak59%'
  OR type ILIKE '%withdraw%'
  OR coalesce(amount_usdt, 0) BETWEEN 7.5 AND 10.5
ORDER BY created_at DESC
LIMIT 100;

-- 4) Legacy NOWPayments `transactions` table (if present)
SELECT *
FROM public.transactions
WHERE
  lower(coalesce(tx_hash, payment_id::text, '')) LIKE '%15e187%'
  OR amount BETWEEN 7.5 AND 10.5
ORDER BY created_at DESC
LIMIT 50;

-- 5) User 16 + Talha / Pentest / Security accounts (from user_wallets / profiles)
SELECT 'user_wallets' AS src, user_id, email, name, balance_usdt, updated_at
FROM public.user_wallets
WHERE user_id IN ('16')
   OR lower(coalesce(email, '')) LIKE '%talha%'
   OR lower(coalesce(name, '')) LIKE '%talha%'
   OR lower(coalesce(name, '')) LIKE '%pentest%'
   OR lower(coalesce(name, '')) LIKE '%security%'
   OR lower(coalesce(name, '')) LIKE '%research%'
UNION ALL
SELECT 'profiles', id::text, email, coalesce(full_name, name), NULL, created_at
FROM public.profiles
WHERE id::text = '16'
   OR lower(coalesce(email, '')) LIKE '%talha%'
   OR lower(coalesce(full_name, name, '')) LIKE '%talha%'
   OR lower(coalesce(full_name, name, '')) LIKE '%pentest%'
ORDER BY 1, 2;

-- 6) Join: if a withdrawal row exists, print the linked person clearly
SELECT
  w.id AS withdrawal_id,
  w.ref_code,
  w.user_id,
  coalesce(uw.name, p.full_name, p.name, ub.user_name) AS name,
  coalesce(uw.email, p.email, ub.user_email) AS email,
  w.wallet_address,
  w.amount_usdt,
  w.fee_usdt,
  w.net_usdt,
  w.status,
  w.tx_hash,
  w.admin_note,
  w.created_at,
  w.processed_at
FROM public.usdt_withdrawal_requests w
LEFT JOIN public.user_wallets uw ON uw.user_id = w.user_id::text
LEFT JOIN public.profiles p ON p.id::text = w.user_id::text
LEFT JOIN public.usdt_bank_withdrawals ub ON ub.id = w.id
WHERE
  lower(coalesce(w.tx_hash, '')) LIKE '15e187bd8db%'
  OR coalesce(w.wallet_address, '') ILIKE 'TDcbAK59%'
  OR w.net_usdt BETWEEN 7.9 AND 8.1
  OR w.amount_usdt BETWEEN 9.9 AND 10.1;
