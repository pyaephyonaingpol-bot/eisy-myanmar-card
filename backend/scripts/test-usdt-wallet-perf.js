#!/usr/bin/env node
/**
 * USDT wallet performance guards + balance/overview smoke tests.
 * Run: node backend/scripts/test-usdt-wallet-perf.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function main() {
  console.log('\n== Indexes + query guards ==');
  const mig = read('migrations/055_usdt_wallet_perf_indexes.sql');
  assert.ok(mig.includes('idx_usdt_wallet_tx_user_ref'), 'wallet tx composite index');
  const authPatch = read('migrations/patches/applyUserAuthColumns.js');
  assert.ok(authPatch.includes('idx_users_email_lower'), 'users email lower index in auth patch');
  const sbIdx = read('../supabase/user_wallets_balance_indexes.sql');
  assert.ok(sbIdx.includes('idx_user_wallets_email_lower'), 'supabase email index');

  const transferModel = read('src/models/UsdtInternalTransfer.js');
  assert.ok(transferModel.includes('UNION ALL'), 'internal transfer history uses UNION ALL');

  const overviewSrc = read('src/services/usdtWalletService.js');
  assert.ok(overviewSrc.includes('ensureSupabaseUserWalletInBackground'), 'overview must not await ensure');
  assert.ok(overviewSrc.includes('skipOverlay: true'), 'overview balances prefer Turso');
  assert.ok(overviewSrc.includes('Promise.allSettled'), 'overview parallelizes reads');

  const balanceRoute = read('src/routes/usdtWallet.js');
  assert.ok(balanceRoute.includes('getWalletBalance(req.user.id, { fresh })'), 'balance supports fresh flag');
  assert.ok(balanceRoute.includes('result.wallet'), 'transfer reuses ledger wallet payload');

  const userRoute = read('src/routes/user.js');
  assert.ok(userRoute.includes('ensureSupabaseUserWalletInBackground'), 'home wallet ensure is background');

  const readSvc = read('src/services/supabaseWalletReadService.js');
  assert.ok(readSvc.includes("'15000'"), 'supabase wallet cache TTL default 15s');
  assert.ok(readSvc.includes("'1500'"), 'supabase wallet read timeout default 1.5s');
  assert.ok(readSvc.includes(".eq('email', wantedEmail)"), 'email lookup prefers eq');

  const dash = read('public/dashboard.js');
  assert.ok(dash.includes('getBalance'), 'dashboard fast-path getBalance');
  assert.ok(dash.includes('Instant paint from cache') || dash.includes('_usdtWalletCache'), 'cache paint');
  assert.ok(dash.includes('data.wallet'), 'transfer applies wallet from response');
  console.log('ok');

  console.log('\n== Fast getWalletBalance (Turso-only) ==');
  const dbFile = path.join(require('os').tmpdir(), `eisy-usdt-perf-${Date.now()}.db`);
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

  // Confirm migration indexes applied.
  const idxRows = await db.all(
    `SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_users_email%' OR name LIKE 'idx_usdt_wallet_tx%')`
  );
  const idxNames = idxRows.map((r) => r.name);
  assert.ok(idxNames.includes('idx_users_email_lower'), `expected email index, got ${idxNames.join(',')}`);
  assert.ok(idxNames.includes('idx_usdt_wallet_tx_user_ref'), 'wallet tx index applied');

  const phone = `09${String(Date.now()).slice(-8)}`;
  const email = `perf-${Date.now()}@example.com`;
  const ins = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, balance_usdt_locked) VALUES (?, ?, ?, 42.25, 3.5)`,
    'Perf Test',
    phone,
    email
  );
  const userId = Number(ins.lastID);

  // Hang forever if balance path ever hits Supabase network.
  const supabase = require('../src/lib/supabase');
  const originalGet = supabase.getSupabase;
  let supabaseHits = 0;
  supabase.getSupabase = () => ({
    from() {
      supabaseHits += 1;
      return {
        select() { return this; },
        eq() { return this; },
        ilike() { return this; },
        limit() { return this; },
        maybeSingle() {
          return new Promise(() => { /* never resolves */ });
        },
      };
    },
  });

  delete require.cache[require.resolve('../src/services/supabaseWalletReadService')];
  delete require.cache[require.resolve('../src/services/usdtWalletService')];
  delete require.cache[require.resolve('../src/services/usdtLedgerService')];
  const { getWalletBalance, getWalletOverview } = require('../src/services/usdtWalletService');
  const { transferUsdtInternal } = require('../src/services/usdtLedgerService');
  const UsdtInternalTransfer = require('../src/models/UsdtInternalTransfer');

  const balStarted = Date.now();
  const bal = await getWalletBalance(userId);
  const balElapsed = Date.now() - balStarted;
  assert.ok(balElapsed < 500, `balance should be fast (took ${balElapsed}ms)`);
  assert.strictEqual(Number(bal.available_usdt), 42.25);
  assert.strictEqual(Number(bal.locked_usdt), 3.5);
  assert.strictEqual(bal.source, 'turso');
  console.log('ok');

  console.log('\n== Overview does not hang on supabase ensure ==');
  const ovStarted = Date.now();
  const overview = await getWalletOverview(userId);
  const ovElapsed = Date.now() - ovStarted;
  assert.ok(ovElapsed < 3000, `overview should stay snappy (took ${ovElapsed}ms)`);
  assert.strictEqual(Number(overview.balance_usdt), 42.25);
  console.log('ok');

  console.log('\n== Internal transfer returns wallet payload + indexed history ==');
  const phone2 = `09${String(Date.now() + 1).slice(-8)}`;
  const email2 = `perf-to-${Date.now()}@example.com`;
  const ins2 = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, balance_usdt_locked) VALUES (?, ?, ?, 0, 0)`,
    'Perf To',
    phone2,
    email2
  );
  const toId = Number(ins2.lastID);

  const xferStarted = Date.now();
  const xfer = await transferUsdtInternal(userId, toId, 5, {
    idempotencyKey: `perf-${Date.now()}`,
    note: 'perf test',
  });
  const xferElapsed = Date.now() - xferStarted;
  assert.ok(xfer.wallet, 'transfer returns wallet snapshot');
  assert.strictEqual(Number(xfer.wallet.available_usdt), 37.25);
  assert.ok(xferElapsed < 2000, `transfer should be quick (took ${xferElapsed}ms)`);

  const history = await UsdtInternalTransfer.findByUserId(userId, { limit: 10 });
  assert.ok(history.length >= 1, 'transfer history returns rows');
  console.log('ok');

  supabase.getSupabase = originalGet;
  resetSupabaseClientForTests();
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch { /* ignore */ }

  console.log('\nUSDT wallet perf checks passed.');
}

main().catch((err) => {
  console.error('\nUSDT wallet perf checks FAILED:', err);
  process.exit(1);
});
