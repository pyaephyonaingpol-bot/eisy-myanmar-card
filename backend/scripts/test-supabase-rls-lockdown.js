#!/usr/bin/env node
'use strict';

/**
 * Guards for Supabase RLS lockdown SQL (no live DB required).
 * Run: node backend/scripts/test-supabase-rls-lockdown.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const STRICT = fs.readFileSync(
  path.join(ROOT, 'supabase/security_rls_strict_lockdown.sql'),
  'utf8'
);
const LEGACY = fs.readFileSync(
  path.join(ROOT, 'supabase/security_rls_lockdown.sql'),
  'utf8'
);
const SUPPORT = fs.readFileSync(
  path.join(ROOT, 'supabase/support_messages_realtime.sql'),
  'utf8'
);
const UPLOADS = fs.readFileSync(
  path.join(ROOT, 'supabase/upload_storage.sql'),
  'utf8'
);
const CARD_POOLS = fs.readFileSync(
  path.join(ROOT, 'supabase/card_pools.sql'),
  'utf8'
);
const ORDERS = fs.readFileSync(
  path.join(ROOT, 'supabase/orders.sql'),
  'utf8'
);
const DOCS = fs.readFileSync(
  path.join(ROOT, 'backend/docs/SUPABASE_RLS.md'),
  'utf8'
);

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('strict lockdown script exists and covers tables');
assert.ok(STRICT.includes('FORCE ROW LEVEL SECURITY'), 'forces RLS');
assert.ok(STRICT.includes('DROP FUNCTION IF EXISTS public.is_own_user_id'), 'drops leftover helpers');
assert.ok(STRICT.includes('DROP FUNCTION IF EXISTS public.is_own_user'), 'drops is_own_user typo helper');
assert.ok(!STRICT.includes('w.auth_user_id'), 'no auth_user_id column references');
assert.ok(!STRICT.includes('ADD COLUMN IF NOT EXISTS auth_user_id'), 'does not add auth_user_id');
assert.ok(!STRICT.includes('CREATE OR REPLACE FUNCTION public.is_own_'), 'no own-row helper functions');
assert.ok(!/USING\s*\(\s*public\.is_own_user/i.test(STRICT), 'policies do not call is_own_user*');
assert.ok(STRICT.includes('user_id::text = auth.uid()::text'), 'inline own-row check');
assert.ok(!STRICT.includes('ALTER TABLE storage.objects'), 'does not ALTER storage.objects');
assert.ok(!STRICT.includes('ON storage.objects'), 'does not create storage.objects policies');
for (const table of [
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
  'support_threads',
  'support_messages',
  'profiles',
]) {
  assert.ok(STRICT.includes(`'${table}'`) || STRICT.includes(`public.${table}`), `covers ${table}`);
}
assert.ok(STRICT.includes('DROP POLICY IF EXISTS "anon_all_user_wallets"'), 'drops anon_all');
assert.ok(STRICT.includes('TO service_role'), 'service_role scoped');
assert.ok(STRICT.includes('TO authenticated'), 'authenticated own-row');
assert.ok(STRICT.includes('REVOKE ALL ON TABLE public.%I FROM anon'), 'revokes anon table grants');
assert.ok(!/CREATE POLICY\s+"?authenticated_select_support_messages"?[\s\S]*USING\s*\(\s*true\s*\)/i.test(STRICT),
  'no open support SELECT');
console.log('ok');

section('source SQL no longer ships open service policies');
assert.ok(/FOR ALL TO service_role/i.test(CARD_POOLS), 'card_pools TO service_role');
assert.ok(!/CREATE POLICY "service_role_card_pools" ON card_pools FOR ALL USING \(true\)/i.test(CARD_POOLS),
  'card_pools not open to all roles');
assert.ok(/FOR ALL TO service_role/i.test(ORDERS), 'orders TO service_role');
assert.ok(SUPPORT.includes('authenticated_select_own_support_messages'), 'support own-row policy');
assert.ok(!/USING\s*\(\s*true\s*\)\s*;\s*\n\s*END \$\$;\s*\n\s*DO \$\$/s.test(
  SUPPORT.replace(/service_role[\s\S]*?USING \(true\)/, '')
), 'support messages not open authenticated true');
assert.ok(!SUPPORT.includes('USING (true);\n  END IF;\nEND $$;\n\nDO $$\nBEGIN\n  ALTER PUBLICATION'),
  'removed open authenticated_select_support_messages');
assert.ok(UPLOADS.includes('TO service_role'), 'optional upload_storage.sql still documents service_role');
assert.ok(STRICT.includes('Storage RLS is intentionally omitted'), 'lockdown documents storage via Dashboard');
console.log('ok');

section('docs + legacy pointer');
assert.ok(LEGACY.includes('security_rls_strict_lockdown.sql'), 'legacy points to strict');
assert.ok(DOCS.includes('security_rls_strict_lockdown.sql'), 'docs name emergency script');
assert.ok(DOCS.includes('SUPABASE_SERVICE_ROLE_KEY'), 'docs service role');
assert.ok(DOCS.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY'), 'docs anon key');
console.log('ok');

section('wallet security regression still finds lockdown');
assert.ok(LEGACY.includes('DROP POLICY IF EXISTS "anon_all_user_wallets"'), 'legacy anon drop kept');
console.log('ok');

console.log('\nSupabase RLS lockdown tests — ok');
