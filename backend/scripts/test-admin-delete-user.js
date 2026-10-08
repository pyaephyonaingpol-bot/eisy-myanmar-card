#!/usr/bin/env node
'use strict';

/**
 * Admin Delete User: confirmation gate, hard delete, and protected accounts.
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
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  const DepositRequest = require('../src/models/DepositRequest');
  const { deleteAdminUser } = require('../src/services/adminUserDeleteService');
  const { OWNER_SUPER_ADMIN_EMAILS } = require('../src/services/adminAuthService');

  const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  assert.ok(adminJs.includes('delete-user-btn'), 'row delete button');
  assert.ok(adminJs.includes('openDeleteUserModal'), 'confirmation modal opener');
  assert.ok(adminJs.includes("confirm: 'DELETE'"), 'client sends DELETE confirmation');
  assert.ok(adminHtml.includes('id="deleteUserModal"'), 'delete confirmation modal');
  assert.ok(adminHtml.includes('id="deleteUserConfirmInput"'), 'typed confirmation field');
  assert.ok(routeSrc.includes("'/users/:userId/delete'"), 'delete route');

  const stamp = Date.now();
  const userA = await User.create({
    name: 'Delete Me',
    phone: `09${String(stamp).slice(-8)}`,
    email: `delete-a-${stamp}@example.com`,
    pinHash: 'testhash',
  });
  const userB = await User.create({
    name: 'Keep Me',
    phone: `09${String(stamp + 1).slice(-8)}`,
    email: `delete-b-${stamp}@example.com`,
    pinHash: 'testhash',
  });

  const db = getDb();
  await DepositRequest.create({
    userId: userA.id,
    amountMmk: 0,
    amountUsd: 12.5,
    refCode: `DEL${stamp}`,
    paymentMethod: 'USDT-TRC20',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    purpose: 'usdt_topup',
  });
  await db.run(
    `INSERT INTO kyc_submissions (
      user_id, full_name, id_type, id_number,
      front_photo_path, back_photo_path, selfie_photo_path, status
    ) VALUES (?, 'Delete Me', 'NRC', '12/TEST', '/tmp/front.jpg', '/tmp/back.jpg', '/tmp/selfie.jpg', 'PENDING_REVIEW')`,
    userA.id
  );

  await assert.rejects(
    () => deleteAdminUser(userA.id, { confirm: 'yes', adminId: 999, adminEmail: 'ops@example.com' }),
    (err) => err.code === 'CONFIRMATION_REQUIRED'
  );
  assert.ok(await User.findById(userA.id), 'missing confirmation must leave the user');

  const removed = await deleteAdminUser(userA.id, {
    confirm: 'DELETE',
    adminId: 999,
    adminEmail: 'ops@example.com',
  });
  assert.strictEqual(removed.removed, true);
  assert.strictEqual(removed.source, 'registry');
  assert.ok(!(await User.findById(userA.id)), 'deleted user row is gone');
  const leftoverDeposit = await db.get(
    'SELECT id FROM deposit_requests_v2 WHERE user_id = ?',
    userA.id
  );
  assert.ok(!leftoverDeposit, 'deposit rows for the deleted user are gone');
  const leftoverKyc = await db.get(
    'SELECT id FROM kyc_submissions WHERE user_id = ?',
    userA.id
  );
  assert.ok(!leftoverKyc, 'non-cascade KYC rows are removed');
  assert.ok(await User.findById(userB.id), 'other users stay');

  const ownerEmail = OWNER_SUPER_ADMIN_EMAILS[0];
  const owner = await User.create({
    name: 'Owner',
    phone: `09${String(stamp + 2).slice(-8)}`,
    email: ownerEmail,
    pinHash: 'testhash',
  });
  await assert.rejects(
    () => deleteAdminUser(owner.id, { confirm: 'DELETE', adminId: 999, adminEmail: 'ops@example.com' }),
    (err) => err.code === 'CANNOT_DELETE_OWNER'
  );
  assert.ok(await User.findById(owner.id), 'protected owner remains');

  await assert.rejects(
    () => deleteAdminUser(userB.id, { confirm: 'DELETE', adminId: userB.id, adminEmail: userB.email }),
    (err) => err.code === 'CANNOT_DELETE_SELF'
  );
  assert.ok(await User.findById(userB.id), 'self-delete is refused');

  await User.setAdminRole(userB.id, 'support_admin');
  await assert.rejects(
    () => deleteAdminUser(userB.id, { confirm: 'DELETE', adminId: 999, adminEmail: 'ops@example.com' }),
    (err) => err.code === 'CANNOT_DELETE_ADMIN'
  );
  assert.ok(await User.findById(userB.id), 'admin-role accounts remain');

  await assert.rejects(
    () => deleteAdminUser(4040404, { confirm: 'DELETE', adminId: 999 }),
    (err) => err.code === 'USER_NOT_FOUND'
  );

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('OK admin delete user');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
