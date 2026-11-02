#!/usr/bin/env node
'use strict';

/**
 * One users.id per person, even when a Supabase wallet is keyed by an Auth UUID.
 * Run: node backend/scripts/test-user-identity.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const AUTH_ID = '11111111-2222-4333-8444-555555555555';

function makeSupabase(wallets) {
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
            const end = api._to == null ? wallets.length - 1 : api._to;
            resolve({ data: wallets.slice(start, end + 1), error: null, count: wallets.length });
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
  const dbFile = path.join(os.tmpdir(), `eisy-user-identity-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_user_identity_test_0001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_user_identity';
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');
  const { listAdminUserDirectory } = require('../src/services/adminUserDirectory');
  const { identityLabel, isLocalUserId, isAuthUserId } = require('../src/lib/userIdentity');
  const db = getDb();

  const columns = await db.all(`PRAGMA table_info(users)`);
  assert.ok(columns.some((col) => col.name === 'auth_user_id'), 'users.auth_user_id column exists');

  const local = await User.create({
    name: 'Demo Card',
    phone: '0911110001',
    email: 'demo.card@example.com',
    pinHash: 'hash',
  });
  const before = await db.get('SELECT id, email, balance_usdt, auth_user_id FROM users WHERE id = ?', local.id);

  resetSupabaseClientForTests();
  setSupabaseClientForTests(makeSupabase([
    {
      user_id: AUTH_ID,
      email: 'Demo.Card@example.com',
      name: 'Demo Card',
      balance_usdt: 12.5,
      created_at: '2026-03-02T00:00:00.000Z',
      auth_status: 'active',
    },
    {
      user_id: '9001',
      email: 'wallet9001@example.com',
      name: 'Wallet Only',
      balance_usdt: 3,
      created_at: '2026-03-03T00:00:00.000Z',
      auth_status: 'active',
    },
  ]));

  const page = await listAdminUserDirectory({ limit: 50, offset: 0 });
  const demo = page.users.find((row) => normalize(row.email) === 'demo.card@example.com');
  const orphan = page.users.find((row) => String(row.id) === '9001');
  assert.ok(demo, 'local user stays in the directory');
  assert.strictEqual(String(demo.id), String(local.id), 'canonical id is users.id');
  assert.strictEqual(demo.auth_user_id, AUTH_ID, 'auth uuid is attached beside the local id');
  assert.strictEqual(page.users.filter((row) => normalize(row.email) === 'demo.card@example.com').length, 1, 'email does not create a second user');
  assert.ok(orphan, 'unlinked wallet remains visible');
  assert.strictEqual(orphan.email, 'wallet9001@example.com');
  assert.strictEqual(Number(demo.balance_usdt), 12.5, 'empty local balance can display the linked wallet balance');

  const stored = await db.get('SELECT id, email, name, balance_usdt, auth_user_id FROM users WHERE id = ?', local.id);
  assert.strictEqual(stored.email, before.email);
  assert.strictEqual(Number(stored.balance_usdt || 0), Number(before.balance_usdt || 0), 'local balance row is not rewritten');
  assert.strictEqual(stored.auth_user_id, AUTH_ID, 'only the empty auth link is filled');
  assert.strictEqual(await db.get('SELECT COUNT(*) AS c FROM users').then((row) => Number(row.c)), 1, 'no user rows are inserted or deleted');

  await User.rememberAuthUserId(local.id, '99999999-8888-4777-8666-555555555555');
  const kept = await db.get('SELECT auth_user_id FROM users WHERE id = ?', local.id);
  assert.strictEqual(kept.auth_user_id, AUTH_ID, 'an existing auth link is kept');

  assert.strictEqual(identityLabel({
    user_id: local.id,
    user_name: 'Demo Card',
    user_email: 'demo.card@example.com',
    auth_user_id: AUTH_ID,
  }), `Demo Card · demo.card@example.com · #${local.id} · ${AUTH_ID}`);
  assert.strictEqual(isLocalUserId(local.id), true);
  assert.strictEqual(isAuthUserId(AUTH_ID), true);
  assert.strictEqual(isLocalUserId(AUTH_ID), false);

  const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(adminJs.includes('userIdentityHtml') && adminJs.includes('userIdentityText'), 'admin uses one identity formatter');
  assert.ok(dash.includes('· #${user.id}'), 'dashboard account line includes the user id');
  assert.ok(dash.includes("sumUserId"), 'profile overview shows the user id');

  const schema = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');
  const trigger = fs.readFileSync(path.join(__dirname, '../../supabase/auth_profiles.sql'), 'utf8');
  assert.ok(schema.includes('auth_user_id TEXT'), 'supabase wallet keeps an auth uuid column');
  assert.ok(trigger.includes('LOWER(email) = LOWER(NEW.email)'), 'auth signup links an existing wallet by email');
  assert.ok(!trigger.includes('DELETE FROM'), 'auth signup does not delete wallets');

  resetSupabaseClientForTests();
  await closeDb();
  console.log('ok — user identity uses users.id');
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
