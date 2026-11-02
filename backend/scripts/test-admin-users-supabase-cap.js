#!/usr/bin/env node
/**
 * Supabase user_wallets can be capped at 15 rows per PostgREST response
 * while count says 49. The admin directory must still return every wallet.
 *
 * Run: node backend/scripts/test-admin-users-supabase-cap.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function makeCappedSupabase(wallets, cap = 15) {
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
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async (row) => ({ data: row, error: null }),
        then(resolve, reject) {
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
        },
      };
      return api;
    },
  };
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-users-cap-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_admin_users_cap_test_001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_admin_users_cap';
  for (const key of Object.keys(process.env)) {
    if (/DATABASE_AUTH_TOKEN|TURSO_AUTH/i.test(key)) delete process.env[key];
  }

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  const { listAdminUserDirectory } = require('../src/services/adminUserDirectory');
  const db = getDb();

  try {
    const localIds = [];
    for (let i = 1; i <= 15; i += 1) {
      const user = await User.create({
        name: `Local ${i}`,
        phone: `09${String(20000000 + i)}`,
        email: `local${i}@example.com`,
        pinHash: `hash-${i}`,
      });
      localIds.push(user.id);
      await db.run(
        `UPDATE users SET created_at = ? WHERE id = ?`,
        '2026-01-01 00:00:00',
        user.id
      );
    }

    const wallets = localIds.map((id, index) => ({
      user_id: String(id),
      email: `wallet${id}@example.com`,
      name: `Wallet ${id}`,
      balance_usdt: index + 1,
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
      auth_status: 'active',
    }));
    for (let i = 1; i <= 34; i += 1) {
      const id = 5000 + i;
      const created = new Date(Date.UTC(2026, 2, i)).toISOString();
      wallets.push({
        user_id: String(id),
        email: `wallet${id}@example.com`,
        name: `Wallet ${id}`,
        balance_usdt: id,
        created_at: created,
        updated_at: created,
        auth_status: i === 3 ? 'blocked' : 'active',
      });
    }
    const newestId = '5034';
    const tursoCount = Number((await db.get('SELECT COUNT(*) AS c FROM users')).c);
    const total = tursoCount + 34;

    resetSupabaseClientForTests();
    setSupabaseClientForTests(makeCappedSupabase(wallets, 15));

    const all = await listAdminUserDirectory({ limit: 10000, offset: 0, sort: 'created_at_desc' });
    assert.strictEqual(all.total, total, 'directory includes every Supabase wallet plus Turso users');
    assert.strictEqual(all.users.length, total, 'All page size returns every user in one response');
    assert.strictEqual(String(all.users[0].id), newestId, 'newest created_at is first');
    const local = all.users.find((row) => String(row.id) === String(localIds[0]));
    assert.strictEqual(local.source, 'registry', 'Turso row wins when the same id exists in Supabase');
    assert.strictEqual(local.email, 'local1@example.com');
    const extra = all.users.find((row) => String(row.id) === '5020');
    assert.strictEqual(extra.source, 'supabase');
    assert.strictEqual(extra.email, 'wallet5020@example.com');

    const seen = new Set();
    let offset = 0;
    while (offset < total + 15) {
      const page = await listAdminUserDirectory({ limit: 15, offset, sort: 'created_at_desc' });
      assert.ok(page.users.length > 0);
      assert.strictEqual(page.limit, 15);
      for (const row of page.users) {
        assert.ok(!seen.has(String(row.id)), 'pages do not repeat a user');
        seen.add(String(row.id));
      }
      if (!page.has_more) break;
      offset += page.limit;
    }
    assert.strictEqual(seen.size, total, 'paging 15 at a time still reaches all 49 wallets');

    const found = await listAdminUserDirectory({ q: 'wallet5020@example.com', limit: 50, offset: 0 });
    assert.strictEqual(found.total, 1);
    assert.strictEqual(String(found.users[0].id), '5020');

    const blocked = await listAdminUserDirectory({ status: 'blocked', limit: 50, offset: 0 });
    assert.ok(blocked.users.some((row) => String(row.id) === '5003'));

    const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
    assert.ok(adminJs.includes('usersGoNextPage') && adminJs.includes('usersLoadMore'), 'pager controls stay wired');
    assert.ok(adminJs.includes("params.set('sort'"), 'list request sends sort');

    console.log('test-admin-users-supabase-cap: OK', total, 'users past a 15 row cap');
  } finally {
    resetSupabaseClientForTests();
    await closeDb().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
