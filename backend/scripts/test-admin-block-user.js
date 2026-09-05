#!/usr/bin/env node
'use strict';

/**
 * Admin Block User: Turso auth_status + session revoke + login gate + Supabase mirror.
 * Run: node scripts/test-admin-block-user.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-block-user-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key-for-tests-xxxxx';

  const { initDb, closeDb, getDb } = require('../src/db');
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();

  const User = require('../src/models/User');
  const UserSession = require('../src/models/UserSession');
  const sync = require('../src/services/supabaseSyncService');
  const originalSync = sync.syncUserWalletById;

  let lastUpsert = null;
  let upsertCount = 0;
  sync.syncUserWalletById = async (userId) => {
    const { isUserBlocked, normalizeAuthStatus } = require('../src/lib/userAuthStatus');
    const user = await User.findById(userId);
    const authStatus = normalizeAuthStatus(user.auth_status);
    lastUpsert = {
      user_id: String(user.id),
      email: user.email || null,
      name: user.name || null,
      auth_status: authStatus,
      is_blocked: isUserBlocked(authStatus),
    };
    upsertCount += 1;
    return lastUpsert;
  };

  // Reload block service so it picks up the stubbed sync export.
  const blockPath = require.resolve('../src/services/adminUserBlockService');
  delete require.cache[blockPath];
  const { setUserBlockStatus } = require('../src/services/adminUserBlockService');
  const { isUserBlocked, assertUserNotBlocked } = require('../src/lib/userAuthStatus');
  const authService = require('../src/services/authService');

  try {
    const email = `block-${Date.now()}@example.com`;
    const phone = `09${String(Date.now()).slice(-8)}`;
    const user = await User.create({
      name: 'Block Test',
      phone,
      email,
      pinHash: 'testhash',
    });
    const userId = user.id;

    await UserSession.create({
      userId,
      sessionToken: 'test-session-token-block-1',
      deviceName: 'test',
      devicePlatform: 'node',
      ipAddress: '127.0.0.1',
      expiresAt: new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' '),
    });

    assert.strictEqual(isUserBlocked(await User.findById(userId)), false);

    const blocked = await setUserBlockStatus(userId, {
      status: 'blocked',
      reason: 'fraud review',
      adminId: 999,
      adminEmail: 'admin@example.com',
    });
    assert.strictEqual(blocked.unchanged, false);
    assert.strictEqual(blocked.new_status, 'blocked');
    assert.ok(blocked.sessions_revoked >= 1, 'expected sessions revoked');

    const after = await User.findById(userId);
    assert.strictEqual(after.auth_status, 'blocked');
    assert.strictEqual(isUserBlocked(after), true);
    assert.ok(upsertCount >= 1, 'expected supabase sync');
    assert.strictEqual(lastUpsert.is_blocked, true);
    assert.strictEqual(lastUpsert.auth_status, 'blocked');

    const session = await UserSession.findByToken('test-session-token-block-1');
    assert.ok(!session, 'blocked user sessions must be revoked');

    await assert.rejects(
      () => authService.loginWithPin({ email, pin: '123456', ipAddress: '127.0.0.1' }),
      (err) => err.code === 'ACCOUNT_BLOCKED' || /blocked/i.test(String(err.message || ''))
    );
    await assert.rejects(
      () => authService.sendLoginOtp(email, '127.0.0.1'),
      (err) => err.code === 'ACCOUNT_BLOCKED' || /blocked/i.test(String(err.message || ''))
    );
    assert.throws(
      () => assertUserNotBlocked(after, { action: 'deposit' }),
      (err) => err.code === 'ACCOUNT_BLOCKED'
    );

    const unblocked = await setUserBlockStatus(userId, {
      status: 'active',
      reason: 'cleared',
      adminId: 999,
      adminEmail: 'admin@example.com',
    });
    assert.strictEqual(unblocked.new_status, 'active');
    const restored = await User.findById(userId);
    assert.strictEqual(restored.auth_status, 'active');
    assert.strictEqual(isUserBlocked(restored), false);
    assert.strictEqual(lastUpsert.is_blocked, false);

    const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
    assert.ok(adminJs.includes('block-user-btn'), 'admin UI must render Block User button');
    assert.ok(adminJs.includes('/api/admin/users/') && adminJs.includes('/status'), 'admin UI must call status endpoint');
    const adminRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
    assert.ok(adminRoutes.includes('/users/:userId/status'), 'admin route must expose status endpoint');

    assert.ok(getDb());
    console.log('Admin block user tests — ok');
  } finally {
    sync.syncUserWalletById = originalSync;
    await closeDb().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
