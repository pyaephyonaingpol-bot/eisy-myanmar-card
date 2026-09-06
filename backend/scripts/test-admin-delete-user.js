#!/usr/bin/env node
'use strict';

/**
 * Admin Delete User: remove test/unwanted accounts + related rows.
 * Run: node scripts/test-admin-delete-user.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-delete-user-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key-for-tests-xxxxx';

  const { initDb, closeDb, getDb } = require('../src/db');
  const sbMod = require('../src/lib/supabase');
  if (typeof sbMod.resetSupabaseClientForTests === 'function') {
    sbMod.resetSupabaseClientForTests();
  }
  await initDb();

  const User = require('../src/models/User');
  const UserSession = require('../src/models/UserSession');

  const deletedWalletIds = [];

  function installSupabaseStub(mod) {
    mod.isSupabaseEnabled = () => true;
    mod.getSupabase = () => ({
      from(table) {
        return {
          delete() {
            return {
              eq: async (col, val) => {
                if (table === 'user_wallets' && col === 'user_id') {
                  deletedWalletIds.push(String(val));
                }
                return { error: null };
              },
            };
          },
          update() {
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      },
    });
  }

  // Clear caches and stub before loading the delete service (it destructures supabase helpers at require-time).
  const supabasePath = require.resolve('../src/lib/supabase');
  const deletePath = require.resolve('../src/services/adminUserDeleteService');
  delete require.cache[supabasePath];
  delete require.cache[deletePath];
  const sbFresh = require('../src/lib/supabase');
  installSupabaseStub(sbFresh);
  const { deleteUserById } = require('../src/services/adminUserDeleteService');

  try {
    const stamp = Date.now();
    const email = `delete-me-${stamp}@example.com`;
    const adminEmail = `admin-keeper-${stamp}@example.com`;

    const victim = await User.create({
      name: 'Delete Me',
      phone: `09${String(stamp).slice(-8)}`,
      email,
      pinHash: 'testhash',
    });
    const admin = await User.create({
      name: 'Admin Keeper',
      phone: `08${String(stamp).slice(-8)}`,
      email: adminEmail,
      pinHash: 'testhash',
    });
    await User.setAdminRole(admin.id, 'super_admin');

    await UserSession.create({
      userId: victim.id,
      sessionToken: 'delete-user-session-token-1',
      deviceName: 'test',
      devicePlatform: 'node',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' '),
    });

    let confirmErr;
    try {
      await deleteUserById(victim.id, {
        adminId: admin.id,
        adminEmail,
        confirmEmail: 'wrong@example.com',
      });
    } catch (err) {
      confirmErr = err;
    }
    assert(confirmErr, 'wrong confirm email should fail');
    assert.strictEqual(confirmErr.code, 'CONFIRM_EMAIL_MISMATCH');
    assert(await User.findById(victim.id), 'user still exists after failed confirm');

    let selfErr;
    try {
      await deleteUserById(admin.id, {
        adminId: admin.id,
        adminEmail,
        confirmEmail: adminEmail,
      });
    } catch (err) {
      selfErr = err;
    }
    assert(selfErr, 'self-delete should fail');
    assert.strictEqual(selfErr.code, 'CANNOT_DELETE_SELF');

    let adminErr;
    try {
      await deleteUserById(admin.id, {
        adminId: victim.id,
        adminEmail: email,
        confirmEmail: adminEmail,
      });
    } catch (err) {
      adminErr = err;
    }
    assert(adminErr, 'admin-role delete should fail');
    assert.strictEqual(adminErr.code, 'CANNOT_DELETE_ADMIN');

    const result = await deleteUserById(victim.id, {
      adminId: admin.id,
      adminEmail,
      confirmEmail: email,
      reason: 'test cleanup',
    });
    assert.strictEqual(result.deleted, true);
    assert.strictEqual(result.user.email, email);
    assert.ok(!(await User.findById(victim.id)), 'user row removed');
    assert.ok(deletedWalletIds.includes(String(victim.id)), 'supabase wallet delete attempted');

    const remainingSessions = await getDb().get(
      'SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = ?',
      victim.id
    );
    assert.strictEqual(Number(remainingSessions?.c || 0), 0, 'sessions cascade-removed');

    const adminJs = fs.readFileSync(path.join('public', 'admin.js'), 'utf8');
    assert.ok(adminJs.includes('delete-user-btn'), 'admin UI has Delete User button');
    assert.ok(adminJs.includes('/api/admin/users/'), 'admin UI calls users API');
    assert.ok(adminJs.includes('confirm_email'), 'admin UI sends confirm_email');
    assert.ok(adminJs.includes('async deleteUser'), 'admin UI has deleteUser handler');

    const route = fs.readFileSync(path.join('src', 'routes', 'admin.js'), 'utf8');
    assert.ok(route.includes("router.delete('/users/:userId'"), 'DELETE /users/:userId route exists');
    assert.ok(route.includes('deleteUserById'), 'route uses deleteUserById');

    console.log('ADMIN DELETE USER TESTS PASSED');
  } finally {
    await closeDb().catch(() => {});
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
