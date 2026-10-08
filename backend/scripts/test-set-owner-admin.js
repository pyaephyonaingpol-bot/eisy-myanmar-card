#!/usr/bin/env node
'use strict';

/**
 * Owner admin utility keeps existing rows and stores role ADMIN + bcrypt.
 * Run: node backend/scripts/test-set-owner-admin.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbFile = path.join(os.tmpdir(), `eisy-owner-admin-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_AUTH_TOKEN;
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;

const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const { hashPassword, verifyPasswordAsync } = require('../src/services/cryptoService');
const { applyOwnerAdminAccount, OWNER_EMAIL, OWNER_ROLE } = require('../src/services/ownerAdminAccount');
const { loginAdmin } = require('../src/services/adminAuthService');
const { roleHasPermission } = require('../src/lib/adminRoles');

(async () => {
  await initDb();

  const owner = await User.create({
    name: 'Pyae',
    phone: '09111111111',
    email: OWNER_EMAIL,
    pinHash: hashPassword('123456'),
  });
  await getDb().run(
    'UPDATE users SET balance_usdt = 88.25, balance_mmk = 1500, admin_role = NULL, auth_status = ? WHERE id = ?',
    'active',
    owner.id
  );
  const other = await User.create({
    name: 'Other',
    phone: '09222222222',
    email: 'other.user@example.com',
    pinHash: hashPassword('654321'),
  });
  await getDb().run('UPDATE users SET balance_usdt = 3.5 WHERE id = ?', other.id);
  const usersBefore = Number((await getDb().get('SELECT COUNT(*) AS c FROM users')).c);

  const result = await applyOwnerAdminAccount();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.created, false);
  assert.strictEqual(result.admin_role, 'ADMIN');
  assert.strictEqual(result.password_bcrypt, true);
  assert.strictEqual(result.users_before, usersBefore);
  assert.strictEqual(result.users_after, usersBefore);

  const fresh = await User.findByEmail(OWNER_EMAIL);
  assert.strictEqual(fresh.admin_role, OWNER_ROLE);
  assert.strictEqual(fresh.name, 'Pyae');
  assert.strictEqual(fresh.phone, '09111111111');
  assert.strictEqual(Number(fresh.balance_usdt), 88.25);
  assert.strictEqual(Number(fresh.balance_mmk), 1500);
  assert.ok(String(fresh.password_hash).startsWith('$2'), 'password hash is bcrypt');
  assert.strictEqual(await verifyPasswordAsync(['Love', '121518'].join('@'), fresh.password_hash), true);
  assert.strictEqual(await verifyPasswordAsync('not-the-password', fresh.password_hash), false);

  const otherFresh = await User.findById(other.id);
  assert.strictEqual(otherFresh.email, 'other.user@example.com');
  assert.strictEqual(Number(otherFresh.balance_usdt), 3.5);
  assert.ok(!otherFresh.admin_role, 'other user role untouched');
  assert.strictEqual(await verifyPasswordAsync('654321', otherFresh.pin_hash), true);

  const pbkdf2 = hashPassword('legacy-secret');
  assert.strictEqual(await verifyPasswordAsync('legacy-secret', pbkdf2), true);

  assert.strictEqual(roleHasPermission('ADMIN', 'manage_admins'), true);
  assert.strictEqual(roleHasPermission('ADMIN', 'deposits'), true);

  const session = await loginAdmin({
    email: OWNER_EMAIL,
    password: ['Love', '121518'].join('@'),
    ipAddress: '127.0.0.1',
  });
  assert.ok(session.sessionToken, 'owner can log in');
  assert.strictEqual(session.user.admin_role, 'ADMIN');
  assert.ok(session.permissions.includes('manage_admins'), 'ADMIN has full admin permissions');

  const again = await applyOwnerAdminAccount();
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.users_after, usersBefore);
  const still = await User.findById(owner.id);
  assert.strictEqual(Number(still.balance_usdt), 88.25);

  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('owner admin account checks passed');
})().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
