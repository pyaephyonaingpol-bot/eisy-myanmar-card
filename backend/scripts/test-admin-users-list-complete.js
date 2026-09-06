#!/usr/bin/env node
'use strict';

/**
 * Admin users list must return every Turso user (no silent row cap) and
 * backfill Supabase user_wallets for the full set.
 *
 * Run: node scripts/test-admin-users-list-complete.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fakeJwt(role) {
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${b64url({
    role,
    iss: 'supabase',
    iat: 1700000000,
    exp: 2000000000,
  })}.sig`;
}

function makeFakeSupabase(upserted) {
  const from = (table) => {
    const api = {
      select() { return api; },
      eq() { return api; },
      ilike() { return api; },
      order() { return api; },
      range() { return api; },
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (row) => {
        if (table === 'user_wallets') {
          upserted.push(String(row.user_id));
        }
        return { data: row, error: null };
      },
    };
    return api;
  };
  return { from };
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-users-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_admin_users_test_001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_admin_users_test';

  const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  assert.ok(adminJs.includes('usersTableCount'), 'admin UI shows user count');
  assert.ok(adminJs.includes('Showing '), 'admin UI renders Showing X of Y');

  const adminRoute = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  assert.ok(!/FROM users[\s\S]{0,220}LIMIT\s+15\b/i.test(adminRoute), 'must not hard-cap users at 15');
  assert.ok(!/FROM users[\s\S]{0,220}LIMIT\s+200\b/i.test(adminRoute), 'must not silently cap admin users at 200');
  assert.ok(
    adminRoute.includes('backfillAllUserWalletsInBackground'),
    'admin users list triggers Supabase backfill'
  );
  assert.ok(adminRoute.includes('total'), 'admin users response includes total');

  const {
    looksLikePublishableOrAnonKey,
    looksLikeServiceRoleKey,
    getPublicSupabaseConfig,
    resetSupabaseClientForTests,
    setSupabaseClientForTests,
  } = require('../src/lib/supabase');

  const serviceJwt = fakeJwt('service_role');
  const anonJwt = fakeJwt('anon');
  assert.strictEqual(looksLikeServiceRoleKey(serviceJwt), true);
  assert.strictEqual(
    looksLikePublishableOrAnonKey(serviceJwt),
    false,
    'service_role JWT must not be treated as a public anon key'
  );
  assert.strictEqual(looksLikePublishableOrAnonKey(anonJwt), true);

  resetSupabaseClientForTests();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = serviceJwt;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceJwt;
  const pub = getPublicSupabaseConfig();
  assert.strictEqual(pub.enabled, false, 'public config disabled when only service_role is available');

  resetSupabaseClientForTests();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_admin_users_test';
  const upserted = [];
  setSupabaseClientForTests(makeFakeSupabase(upserted));

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  const sync = require('../src/services/supabaseSyncService');

  try {
    const TARGET = 19;
    for (let i = 0; i < TARGET; i += 1) {
      await User.create({
        name: `User ${i + 1}`,
        phone: `09${String(10000000 + i)}`,
        email: `user${i + 1}-${Date.now()}@example.com`,
        pinHash: `hash-${i}`,
      });
    }

    const db = getDb();
    const totalRow = await db.get('SELECT COUNT(*) AS c FROM users');
    assert.strictEqual(Number(totalRow.c), TARGET, `seeded ${TARGET} users`);

    const users = await db.all(`
      SELECT id, email, name, phone, balance, balance_mmk, balance_usdt, email_verified, auth_status, created_at
      FROM users
      ORDER BY created_at DESC, id DESC
    `);
    assert.strictEqual(users.length, TARGET, 'admin query returns every user');
    assert.ok(sync.isSupabaseEnabled(), 'supabase enabled for backfill');

    const backfill = await sync.backfillAllUserWallets({ pageSize: 7 });
    assert.strictEqual(backfill.total, TARGET);
    assert.strictEqual(backfill.synced, TARGET, 'backfill syncs every Turso user');
    assert.strictEqual(backfill.failed || 0, 0, 'backfill has no failures');
    assert.strictEqual(upserted.length, TARGET, 'upsert called once per user');
    assert.strictEqual(new Set(upserted).size, TARGET, 'each user upserted');

    console.log('ok — admin users list returns all', TARGET, 'users and backfills Supabase mirrors');
  } finally {
    resetSupabaseClientForTests();
    await closeDb();
    try {
      fs.unlinkSync(dbFile);
    } catch (_) {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
