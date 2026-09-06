#!/usr/bin/env node
'use strict';

/**
 * Ensure upsertUserWalletAdaptive strips columns missing from production
 * (balance_mmk / auth_status / is_blocked) so new users are not stuck out of
 * the Supabase mirror.
 *
 * Run: node scripts/test-supabase-wallet-upsert-adaptive.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const syncSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/supabaseSyncService.js'),
    'utf8'
  );
  assert.ok(syncSrc.includes('upsertUserWalletAdaptive'), 'adaptive upsert helper present');
  assert.ok(
    syncSrc.includes('PROD_USER_WALLET_COLUMNS') || syncSrc.includes('pickProdUserWalletColumns'),
    'prefers known production user_wallets columns'
  );
  assert.ok(
    syncSrc.includes('stripping unavailable user_wallets column'),
    'logs stripped columns'
  );

  const dbFile = path.join(os.tmpdir(), `eisy-adaptive-upsert-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_adaptive_upsert_test';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_adaptive_upsert';

  const rejected = new Set(['balance_mmk', 'auth_status', 'is_blocked']);
  const acceptedPayloads = [];

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  setSupabaseClientForTests({
    from(table) {
      assert.strictEqual(table, 'user_wallets');
      return {
        select() { return this; },
        eq() { return this; },
        ilike() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async (row) => {
          for (const col of rejected) {
            if (Object.prototype.hasOwnProperty.call(row, col)) {
              return {
                data: null,
                error: {
                  message: `Could not find the '${col}' column of 'user_wallets' in the schema cache`,
                },
              };
            }
          }
          acceptedPayloads.push({ ...row });
          return { data: row, error: null };
        },
      };
    },
  });

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');
  delete require.cache[require.resolve('../src/services/supabaseSyncService')];
  delete require.cache[require.resolve('../src/services/supabaseWalletReadService')];
  const sync = require('../src/services/supabaseSyncService');

  try {
    const user = await User.create({
      name: 'Adaptive Upsert',
      phone: `09${String(Date.now()).slice(-8)}`,
      email: `adaptive-${Date.now()}@example.com`,
      pinHash: 'hash-adaptive',
    });

    const result = await sync.ensureSupabaseUserWallet(user.id, { syncIfExists: true });
    assert.strictEqual(result.ensured, true, 'ensure succeeds against prod-like schema');
    assert.ok(acceptedPayloads.length >= 1, 'at least one successful upsert after stripping');
    const payload = acceptedPayloads[acceptedPayloads.length - 1];
    assert.strictEqual(payload.user_id, String(user.id));
    assert.ok(!('balance_mmk' in payload), 'balance_mmk stripped');
    assert.ok(!('auth_status' in payload), 'auth_status stripped');
    assert.ok(!('is_blocked' in payload), 'is_blocked stripped');
    assert.ok('balance_usdt' in payload, 'balance_usdt retained');

    acceptedPayloads.length = 0;
    const db = getDb();
    for (let i = 0; i < 5; i += 1) {
      await User.create({
        name: `U${i}`,
        phone: `08${String(10000000 + i)}`,
        email: `u${i}-${Date.now()}@example.com`,
        pinHash: `h${i}`,
      });
    }
    const total = Number((await db.get('SELECT COUNT(*) AS c FROM users')).c);
    const backfill = await sync.backfillAllUserWallets({ pageSize: 3 });
    assert.strictEqual(backfill.total, total);
    assert.strictEqual(backfill.synced, total, 'backfill syncs every user despite schema gaps');
    assert.strictEqual(backfill.failed || 0, 0);

    console.log('ok — adaptive user_wallets upsert strips missing columns and backfills all users');
  } finally {
    resetSupabaseClientForTests();
    await closeDb();
    try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
