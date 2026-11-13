#!/usr/bin/env node
/**
 * Admin auth + directory timeout hardening checks.
 * Run: node backend/scripts/test-admin-auth-504-hardening.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function makeBudgetSupabase(wallets, { cap = 15, delayMs = 30 } = {}) {
  return {
    from(table) {
      const api = {
        _from: 0,
        _to: null,
        select() { return api; },
        eq() { return api; },
        ilike() { return api; },
        order() { return api; },
        range(fromIdx, toIdx) {
          api._from = fromIdx;
          api._to = toIdx;
          return api;
        },
        then(resolve, reject) {
          setTimeout(() => {
            try {
              if (table !== 'user_wallets') {
                resolve({ data: [], error: null, count: 0 });
                return;
              }
              const start = api._from || 0;
              const requestedEnd = api._to == null ? wallets.length - 1 : api._to;
              const cappedEnd = Math.min(requestedEnd, start + cap - 1);
              const slice = wallets.slice(start, cappedEnd + 1);
              resolve({ data: slice, error: null, count: wallets.length });
            } catch (err) {
              reject(err);
            }
          }, delayMs);
        },
      };
      return api;
    },
  };
}

async function main() {
  const authSrc = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
  assert.ok(authSrc.includes('ADMIN_AUTH_UNAVAILABLE'), 'transient auth failures return 503 code');
  assert.ok(authSrc.includes('findAdminSessionByToken'), 'admin session lookup retries once');
  assert.ok(authSrc.includes('isTransientDbError'), 'transient Turso errors are classified');

  const proxySrc = fs.readFileSync(path.join(__dirname, '../src/routes/supabaseProxy.js'), 'utf8');
  assert.ok(/SUPABASE_PROXY_TIMEOUT_MS\) \|\| 25000/.test(proxySrc), 'proxy default timeout under gateway limit');

  const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  assert.ok(adminJs.includes('warmAdminTabsStaggered'), 'admin warm path is staggered');

  const grantsSql = fs.readFileSync(
    path.join(__dirname, '../../supabase/security_admin_service_role_grants.sql'),
    'utf8'
  );
  assert.ok(grantsSql.includes('GRANT ALL ON TABLE'), 'service_role grant SQL present');
  assert.ok(grantsSql.includes('TO service_role'), 'grants target service_role');

  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_admin_auth_504_001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_admin_auth_504';
  process.env.ADMIN_DIRECTORY_SUPABASE_BUDGET_MS = '120';
  process.env.ADMIN_DIRECTORY_SUPABASE_CACHE_TTL_MS = '0';
  process.env.ADMIN_DIRECTORY_SUPABASE_MAX_ROWS = '5000';

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  const {
    resetDirectoryWalletCacheForTests,
    listSupabaseUserWallets,
  } = require('../src/services/supabaseSyncService');

  const wallets = [];
  for (let i = 1; i <= 200; i += 1) {
    wallets.push({
      user_id: String(1000 + i),
      email: `w${i}@example.com`,
      name: `W ${i}`,
      balance_usdt: i,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      auth_status: 'active',
    });
  }

  resetSupabaseClientForTests();
  resetDirectoryWalletCacheForTests();
  setSupabaseClientForTests(makeBudgetSupabase(wallets, { cap: 15, delayMs: 40 }));

  const started = Date.now();
  const result = await listSupabaseUserWallets();
  const elapsed = Date.now() - started;

  assert.ok(result.truncated || result.error, 'budgeted scan reports truncation or stops early');
  assert.ok(result.rows.length < wallets.length, 'budget stops before full 200-row scan');
  assert.ok(elapsed < 2500, `budgeted scan finishes quickly (took ${elapsed}ms)`);

  console.log('test-admin-auth-504-hardening: OK', {
    rows: result.rows.length,
    truncated: result.truncated,
    error: result.error,
    elapsed_ms: elapsed,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
