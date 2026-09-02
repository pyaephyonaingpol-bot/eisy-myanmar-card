#!/usr/bin/env node
'use strict';

/**
 * Admin Adjust USDT must update Turso and mirror to Supabase user_wallets,
 * and dashboard wallet overlay must not serve a stale mirrored balance.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

const walletServiceSrc = fs.readFileSync(path.join(__dirname, '../src/services/walletService.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(__dirname, '../src/services/supabaseSyncService.js'), 'utf8');
const overlaySrc = fs.readFileSync(path.join(__dirname, '../src/services/supabaseWalletReadService.js'), 'utf8');
const userRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');

assert.ok(/await syncUserWalletById\(userId\)/.test(walletServiceSrc), 'adjustUsdt must await Supabase sync');
assert.ok(/invalidateUserWalletCache\(userId\)/.test(syncSrc), 'syncUserWalletById must invalidate wallet cache');
assert.ok(/localUpdatedMs > supabaseUpdatedMs/.test(overlaySrc) || /localUpdatedMs > /.test(overlaySrc), 'overlay must prefer fresher Turso balance');
assert.ok(/updated_at:\s*user\.updated_at/.test(userRoutes), 'wallet route must pass Turso updated_at into overlay');

async function integrationTest() {
  const dbFile = path.join(os.tmpdir(), `eisy-adjust-usdt-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';

  const { initDb, closeDb, getDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();
  const db = getDb();

  const email = `adjust-${Date.now()}@example.com`;
  const phone = `09${String(Date.now()).slice(-8)}`;
  const ins = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, updated_at)
     VALUES (?, ?, ?, ?, datetime('now', '-1 minute'))`,
    'Adjust Test',
    phone,
    email,
    10
  );
  const userId = Number(ins.lastID);

  let lastUpsert = null;
  let upsertCount = 0;
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
          // Stale Supabase mirror still shows 10 USDT
          return Promise.resolve({
            data: {
              user_id: String(userId),
              email,
              name: 'Adjust Test',
              balance_mmk: 0,
              balance_usdt: 10,
              updated_at: new Date(Date.now() - 60_000).toISOString(),
            },
            error: null,
          });
        },
        upsert(row) {
          upsertCount += 1;
          lastUpsert = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  });

  // Clear module caches that closed over previous supabase client
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes('supabaseSyncService')
      || key.includes('supabaseWalletReadService')
      || key.includes('walletService')
      || key.includes('usdtLedgerService')
    ) {
      delete require.cache[key];
    }
  }

  const { adjustUsdt, walletPayload } = require('../src/services/walletService');
  const {
    overlayWalletPayloadFromSupabase,
    invalidateUserWalletCache,
    parseTimestampMs,
  } = require('../src/services/supabaseWalletReadService');
  const User = require('../src/models/User');

  assert.ok(parseTimestampMs('2026-09-02 12:00:00') > 0, 'sqlite datetime parse');
  assert.ok(parseTimestampMs('2026-09-02T12:00:00.000Z') > 0, 'iso parse');

  invalidateUserWalletCache(userId);
  const updated = await adjustUsdt(userId, 25, 'test admin credit', 'admin');
  assert.ok(updated, 'adjustUsdt returned user');
  assert.strictEqual(Number(updated.balance_usdt), 35, 'Turso balance credited');
  assert.ok(upsertCount >= 1, 'Supabase user_wallets upsert awaited');
  assert.strictEqual(Number(lastUpsert.balance_usdt), 35, 'mirror received new balance');

  // Simulate delayed/failed mirror still serving stale 10 while Turso is 35
  invalidateUserWalletCache(userId);
  const freshUser = await User.findById(userId);
  const overlay = await overlayWalletPayloadFromSupabase(userId, {
    ...walletPayload(freshUser),
    email: freshUser.email,
    updated_at: freshUser.updated_at,
  });
  assert.strictEqual(overlay.source, 'turso', 'overlay must prefer fresher Turso after adjust');
  assert.strictEqual(Number(overlay.balance_usdt), 35, 'dashboard payload shows adjusted balance');

  supabase.getSupabase = originalGet;
  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('ADMIN USDT ADJUST SYNC TESTS PASSED');
}

integrationTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
