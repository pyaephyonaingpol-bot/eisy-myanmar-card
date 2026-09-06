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
  const walletIds = new Set();
  const from = (table) => {
    const api = {
      select() { return api; },
      eq() { return api; },
      ilike() { return api; },
      order() { return api; },
      range(fromIdx, toIdx) {
        api._from = fromIdx;
        api._to = toIdx;
        return api;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (row) => {
        if (table === 'user_wallets') {
          upserted.push(String(row.user_id));
          walletIds.add(String(row.user_id));
        }
        return { data: row, error: null };
      },
      then: undefined,
    };
    // Make thenable for `await sb.from(...).select(...).range(...)`
    api.then = (resolve, reject) => {
      try {
        if (table === 'user_wallets') {
          const ids = [...walletIds].sort((a, b) => Number(a) - Number(b));
          const fromIdx = api._from == null ? 0 : api._from;
          const toIdx = api._to == null ? ids.length - 1 : api._to;
          const slice = ids.slice(fromIdx, toIdx + 1).map((user_id) => ({ user_id }));
          resolve({ data: slice, error: null, count: ids.length });
          return;
        }
        resolve({ data: [], error: null, count: 0 });
      } catch (err) {
        reject(err);
      }
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
  assert.ok(adminJs.includes('usersMirrorStatus'), 'admin UI shows mirror status');
  assert.ok(adminJs.includes('backfillUserWallets'), 'admin UI can trigger wallet backfill');
  assert.ok(adminJs.includes('usersBackfillWalletsBtn'), 'backfill button wired');

  const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  assert.ok(adminHtml.includes('id="usersMirrorStatus"'), 'mirror status element in HTML');
  assert.ok(adminHtml.includes('id="usersBackfillWalletsBtn"'), 'backfill button in HTML');

  const migration = fs.readFileSync(path.join(__dirname, '../migrations/051_users_list_indexes.sql'), 'utf8');
  assert.ok(migration.includes('idx_users_created_at_id') || migration.includes('created_at'), 'users list created_at index migration exists');
  const authPatch = fs.readFileSync(path.join(__dirname, '../migrations/patches/applyUserAuthColumns.js'), 'utf8');
  assert.ok(authPatch.includes('idx_users_auth_status'), 'auth_status index created after auth columns patch');


  const adminRoute = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  assert.ok(!/FROM users[\s\S]{0,220}LIMIT\s+15\b/i.test(adminRoute), 'must not hard-cap users at 15');
  assert.ok(adminRoute.includes('listForAdmin'), 'admin users list uses User.listForAdmin');
  assert.ok(adminRoute.includes('has_more'), 'admin users response includes has_more');
  assert.ok(adminRoute.includes('/users/mirror-status'), 'mirror status is a separate route');
  assert.ok(adminRoute.includes('/users/backfill-wallets'), 'admin backfill wallets route exists');
  assert.ok(adminRoute.includes('total'), 'admin users response includes total');
  assert.ok(!adminRoute.includes('backfillAllUserWalletsInBackground'), 'list route must not trigger background backfill');
  assert.ok(adminJs.includes('usersLoadMoreBtn') || adminJs.includes('usersGoNextPage'), 'admin UI supports pagination');
  assert.ok(adminJs.includes('limit') && adminJs.includes('offset'), 'admin UI requests limit/offset');

  const syncSrc = fs.readFileSync(path.join(__dirname, '../src/services/supabaseSyncService.js'), 'utf8');
  assert.ok(syncSrc.includes('getUserWalletsMirrorStatus'), 'mirror status helper exported');
  assert.ok(syncSrc.includes('.range(from, to)'), 'mirror status paginates past PostgREST defaults');

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

    const page1 = await User.listForAdmin({ limit: 7, offset: 0 });
    assert.strictEqual(page1.total, TARGET, 'paginated total covers every Turso user');
    assert.strictEqual(page1.count, 7, 'first page respects limit');
    assert.strictEqual(page1.has_more, true, 'first page reports has_more');

    const seen = new Set(page1.users.map((u) => u.id));
    let offset = page1.limit;
    while (offset < page1.total) {
      const page = await User.listForAdmin({ limit: 7, offset });
      assert.ok(page.users.length > 0, 'subsequent pages return rows');
      for (const u of page.users) seen.add(u.id);
      offset += page.limit;
      if (!page.has_more) break;
    }
    assert.strictEqual(seen.size, TARGET, 'paging walks the complete user set');

    const lean = page1.users[0] || {};
    assert.ok(!('phone' in lean) && !('balance_mmk' in lean), 'list payload stays lean (no unused profile fields)');
    assert.ok(sync.isSupabaseEnabled(), 'supabase enabled for backfill');

    const backfill = await sync.backfillAllUserWallets({ pageSize: 7 });
    assert.strictEqual(backfill.total, TARGET);
    assert.strictEqual(backfill.synced, TARGET, 'backfill syncs every Turso user');
    assert.strictEqual(backfill.failed || 0, 0, 'backfill has no failures');
    assert.strictEqual(upserted.length, TARGET, 'upsert called once per user');
    assert.strictEqual(new Set(upserted).size, TARGET, 'each user upserted');

    const mirror = await sync.getUserWalletsMirrorStatus();
    assert.strictEqual(mirror.enabled, true);
    assert.strictEqual(mirror.turso_total, TARGET);
    assert.strictEqual(mirror.supabase_total, TARGET);
    assert.strictEqual(mirror.missing_count, 0);
    assert.ok(mirror.missing_user_ids == null || mirror.missing_user_ids.length === 0);
    assert.strictEqual(mirror.in_sync, true, 'mirror status reports full sync');

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
