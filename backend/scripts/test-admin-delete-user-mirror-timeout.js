#!/usr/bin/env node
/**
 * Admin user delete must not await a slow Supabase mirror purge past the
 * response budget (that was returning HTTP 504 on Vercel).
 *
 * Run: node backend/scripts/test-admin-delete-user-mirror-timeout.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function makeSlowSupabase({ delayMs = 5000 } = {}) {
  const deleted = [];
  return {
    deleted,
    rpc: async (name, args) => {
      await new Promise((r) => setTimeout(r, delayMs));
      deleted.push({ rpc: name, args });
      return { data: { user_wallets: { deleted: 1 } }, error: null };
    },
    from(table) {
      return {
        delete() {
          return {
            async eq(_col, value) {
              await new Promise((r) => setTimeout(r, delayMs));
              deleted.push({ table, value });
              return { error: null };
            },
          };
        },
      };
    },
  };
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-delete-mirror-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_delete_mirror_001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_delete_mirror';
  process.env.ADMIN_USER_DELETE_MIRROR_BUDGET_MS = '400';
  process.env.ADMIN_USER_DELETE_MIRROR_TIMEOUT_MS = '15000';
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  // Reload service after env so budget constants are not required — they read env at call time for budget.
  delete require.cache[require.resolve('../src/services/adminUserDeleteService')];
  const { deleteAdminUser } = require('../src/services/adminUserDeleteService');

  const slow = makeSlowSupabase({ delayMs: 5000 });
  resetSupabaseClientForTests();
  setSupabaseClientForTests(slow);

  const stamp = Date.now();
  const user = await User.create({
    name: 'Mirror Slow',
    phone: `09${String(stamp).slice(-8)}`,
    email: `mirror-slow-${stamp}@example.com`,
    pinHash: 'testhash',
  });

  const started = Date.now();
  const result = await deleteAdminUser(user.id, {
    confirm: 'DELETE',
    adminId: 999,
    adminEmail: 'ops@example.com',
  });
  const elapsed = Date.now() - started;

  assert.strictEqual(result.removed, true);
  assert.strictEqual(result.source, 'registry');
  assert.strictEqual(result.supabase_wallet, 'pending', 'slow mirror must not block past budget');
  assert.ok(result.supabase_mirror?.pending, 'mirror payload marks pending');
  assert.ok(elapsed < 2500, `delete returns before gateway timeout (took ${elapsed}ms)`);
  assert.ok(!(await User.findById(user.id)), 'Turso user is already gone');

  // Give the background job a tick — it may still be running; we only care the HTTP path returned.
  await new Promise((r) => setTimeout(r, 50));

  console.log('test-admin-delete-user-mirror-timeout: OK', { elapsed_ms: elapsed, result });

  resetSupabaseClientForTests();
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
