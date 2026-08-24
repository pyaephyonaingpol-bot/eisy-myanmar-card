#!/usr/bin/env node
/**
 * USDT wallet loading / Supabase read timeout smoke test.
 * Run: node backend/scripts/test-usdt-wallet-loading.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

async function main() {
  console.log('\n== dashboard.js loading guards present ==');
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('clearUsdtWalletLoadingState'), 'clearUsdtWalletLoadingState helper required');
  assert.ok(dash.includes('REQUEST_TIMEOUT'), 'timeout error handling required');
  assert.ok(dash.includes('needsPinUnlock'), 'PIN gate before overview fetch required');
  assert.ok(dash.includes("force: forceRefresh"), 'force refresh must supersede stuck inflight');
  console.log('ok');

  console.log('\n== Auth.api AbortController timeout ==');
  const auth = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
  assert.ok(auth.includes('AbortController'), 'Auth.api must use AbortController');
  assert.ok(auth.includes('timeoutMs'), 'Auth.api must accept timeoutMs');
  assert.ok(auth.includes('REQUEST_TIMEOUT'), 'Auth.api must map abort to REQUEST_TIMEOUT');
  console.log('ok');

  console.log('\n== Supabase wallet read timeout ==');
  const sb = fs.readFileSync(path.join(__dirname, '../src/services/supabaseWalletReadService.js'), 'utf8');
  assert.ok(sb.includes('withTimeout'), 'supabase wallet read must use withTimeout');
  assert.ok(sb.includes('SUPABASE_READ_TIMEOUT_MS'), 'timeout env/constant required');
  console.log('ok');

  console.log('\n== getWalletOverview survives hanging supabase ==');
  const dbFile = path.join(require('os').tmpdir(), `eisy-usdt-load-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';
  process.env.SUPABASE_WALLET_READ_TIMEOUT_MS = '200';

  const { initDb, closeDb, getDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();
  const db = getDb();
  const phone = `09${String(Date.now()).slice(-8)}`;
  const ins = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, balance_usdt_locked) VALUES (?, ?, ?, 12.5, 1.5)`,
    'Load Test',
    phone,
    `load-${Date.now()}@example.com`
  );
  const userId = Number(ins.lastID);

  // Stub getSupabase to hang forever — overlay must time out and fall back.
  const supabase = require('../src/lib/supabase');
  const originalGet = supabase.getSupabase;
  supabase.getSupabase = () => ({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        ilike() { return this; },
        maybeSingle() {
          return new Promise(() => { /* never resolves */ });
        },
      };
    },
  });

  delete require.cache[require.resolve('../src/services/supabaseWalletReadService')];
  delete require.cache[require.resolve('../src/services/usdtWalletService')];
  const { getWalletOverview } = require('../src/services/usdtWalletService');

  const started = Date.now();
  const overview = await getWalletOverview(userId);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `overview should not hang (took ${elapsed}ms)`);
  assert.strictEqual(Number(overview.balance_usdt), 12.5);
  assert.strictEqual(Number(overview.balance_usdt_locked), 1.5);
  console.log('ok');

  supabase.getSupabase = originalGet;
  resetSupabaseClientForTests();
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch { /* ignore */ }

  console.log('\nUSDT wallet loading checks passed.');
}

main().catch((err) => {
  console.error('\nUSDT wallet loading checks FAILED:', err);
  process.exit(1);
});
