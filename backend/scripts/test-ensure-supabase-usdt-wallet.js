#!/usr/bin/env node
/**
 * Auto-provision Supabase user_wallets on login / dashboard load.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

const authService = fs.readFileSync(path.join(__dirname, '../src/services/authService.js'), 'utf8');
const userRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
const usdtWalletService = fs.readFileSync(path.join(__dirname, '../src/services/usdtWalletService.js'), 'utf8');
const syncService = fs.readFileSync(path.join(__dirname, '../src/services/supabaseSyncService.js'), 'utf8');

assert.ok(syncService.includes('ensureSupabaseUserWallet'), 'ensureSupabaseUserWallet exported');
assert.ok(syncService.includes('ensureSupabaseUserWalletInBackground'), 'background helper exported');
assert.ok(authService.includes('ensureSupabaseUserWalletInBackground'), 'auth uses ensure helper');
assert.ok(authService.includes('verifyLoginOtp'), 'OTP login path present');
assert.ok(userRoutes.includes('ensureSupabaseUserWallet'), 'wallet route ensures Supabase row');
assert.ok(usdtWalletService.includes('ensureSupabaseUserWallet'), 'USDT overview ensures Supabase row');

async function integrationTest() {
  const dbFile = path.join(os.tmpdir(), `eisy-ensure-wallet-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';

  const { initDb, closeDb, getDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();
  const db = getDb();

  const phone = `09${String(Date.now()).slice(-8)}`;
  const email = `ensure-${Date.now()}@example.com`;
  const ins = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, ?)`,
    'Ensure Test',
    phone,
    email,
    25
  );
  const userId = Number(ins.lastID);

  let upsertCalls = 0;
  let selectCalls = 0;
  const supabase = require('../src/lib/supabase');
  const originalGet = supabase.getSupabase;
  supabase.getSupabase = () => ({
    from(table) {
      assert.strictEqual(table, 'user_wallets');
      return {
        select() { return this; },
        eq() { return this; },
        ilike() { return this; },
        maybeSingle() {
          selectCalls += 1;
          return Promise.resolve({ data: null, error: null });
        },
        upsert(row) {
          upsertCalls += 1;
          assert.strictEqual(row.user_id, String(userId));
          assert.strictEqual(Number(row.balance_usdt), 25);
          return Promise.resolve({ error: null });
        },
      };
    },
  });

  delete require.cache[require.resolve('../src/services/supabaseWalletReadService')];
  delete require.cache[require.resolve('../src/services/supabaseSyncService')];
  const { ensureSupabaseUserWallet } = require('../src/services/supabaseSyncService');

  const first = await ensureSupabaseUserWallet(userId);
  assert.strictEqual(first.created, true);
  assert.ok(selectCalls >= 1, 'should read Supabase before create');
  assert.strictEqual(upsertCalls, 1, 'should upsert when row missing');

  upsertCalls = 0;
  supabase.getSupabase = () => ({
    from(table) {
      assert.strictEqual(table, 'user_wallets');
      return {
        select() { return this; },
        eq() { return this; },
        ilike() { return this; },
        maybeSingle() {
          return Promise.resolve({
            data: {
              user_id: String(userId),
              email,
              balance_usdt: 25,
              balance_mmk: 0,
              updated_at: new Date().toISOString(),
            },
            error: null,
          });
        },
        upsert() {
          upsertCalls += 1;
          return Promise.resolve({ error: null });
        },
      };
    },
  });
  delete require.cache[require.resolve('../src/services/supabaseWalletReadService')];
  delete require.cache[require.resolve('../src/services/supabaseSyncService')];
  const { ensureSupabaseUserWallet: ensureAgain } = require('../src/services/supabaseSyncService');

  const second = await ensureAgain(userId);
  assert.strictEqual(second.created, false);
  assert.strictEqual(upsertCalls, 0, 'should not upsert when row already exists');

  supabase.getSupabase = originalGet;
  resetSupabaseClientForTests();
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch { /* ignore */ }
}

integrationTest()
  .then(() => {
    console.log('Auto Supabase USDT wallet ensure — ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
