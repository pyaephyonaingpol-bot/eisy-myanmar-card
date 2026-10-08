#!/usr/bin/env node
'use strict';

/**
 * Guards for protected operator admin access + demoted-role login heal.
 * Run: node backend/scripts/test-admin-owner-access.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const serviceSrc = fs.readFileSync(path.join(ROOT, 'src/services/adminAuthService.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const indexSrc = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');

assert.ok(serviceSrc.includes("['pyaephyonaing', 'pol']"), 'owner email allowlisted');
assert.ok(serviceSrc.includes('isProtectedSuperAdminEmail'), 'protected email helper');
assert.ok(serviceSrc.includes('not an admin'), 'login heals demoted admin rows');
assert.ok(serviceSrc.includes('Cannot demote the protected operator'), 'demotion blocked');
assert.ok(serviceSrc.includes('Cannot remove the protected operator'), 'removal blocked');

assert.ok(adminJs.includes('CORE_ADMIN_PAGES'), 'core admin pages set');
assert.ok(adminJs.includes("return 'instant'"), 'pipeline always unified');
assert.ok(!adminJs.includes('Open Instant Admin'), 'hub chooser copy removed from admin.js');
assert.ok(adminHtml.includes('Deposits &amp; KYC'), 'deposits+kyc nav label');
assert.ok(adminHtml.includes('Virtual Cards'), 'virtual cards nav');
assert.ok(adminHtml.includes('id="tabCards"'), 'cards panel restored');
assert.ok(adminHtml.includes('id="pendingCardsTable"'), 'pending cards table');
assert.ok(adminHtml.includes('admin.js?v=20261008adminCleanup'), 'admin.js cache-bust');
assert.ok(indexSrc.includes("res.redirect(302, '/admin')"), 'instant redirects to /admin');

const dbFile = path.join(os.tmpdir(), `eisy-admin-owner-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
const OWNER_EMAIL = ['pyaephyonaing', 'pol'].join('.') + '@' + ['gmail', 'com'].join('.');
process.env.ADMIN_EMAIL = OWNER_EMAIL;
process.env.ADMIN_PASSWORD = 'OwnerAdmin!23456';
process.env.ADMIN_NAME = 'Owner';
delete process.env.DATABASE_AUTH_TOKEN;

const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const {
  ensureEnvSuperAdmin,
  loginAdmin,
  isProtectedSuperAdminEmail,
  removeAdmin,
  updateAdminRole,
} = require('../src/services/adminAuthService');

(async () => {
  await initDb();
  assert.strictEqual(isProtectedSuperAdminEmail(OWNER_EMAIL), true);
  assert.strictEqual(isProtectedSuperAdminEmail('other@example.com'), false);

  const ensured = await ensureEnvSuperAdmin({ source: 'test' });
  assert.strictEqual(ensured.ok, true);
  assert.strictEqual(ensured.user.admin_role, 'ADMIN');

  // Demote owner — login with ADMIN_PASSWORD must heal (previous bug: "not an admin").
  const owner = await User.findByEmail(OWNER_EMAIL);
  await getDb().run('UPDATE users SET admin_role = NULL WHERE id = ?', owner.id);
  const demoted = await User.findByEmail(OWNER_EMAIL);
  assert.ok(!demoted.admin_role, 'owner demoted for test');

  const healed = await loginAdmin({
    email: OWNER_EMAIL,
    password: 'OwnerAdmin!23456',
    ipAddress: '127.0.0.1',
  });
  assert.ok(healed.sessionToken, 'demoted owner can login');
  assert.strictEqual(healed.user.admin_role, 'ADMIN', 'owner restored to ADMIN');

  let demoteBlocked = false;
  try {
    await updateAdminRole(healed.user.id, 'finance_admin', healed.user.id);
  } catch (err) {
    demoteBlocked = /protected operator/i.test(err.message || '');
  }
  assert.ok(demoteBlocked, 'cannot demote protected operator');

  const other = await User.create({
    name: 'Other Admin',
    phone: '09990001122',
    email: 'other-admin@example.com',
    pinHash: null,
  });
  await User.setAdminRole(other.id, 'super_admin');
  let removeBlocked = false;
  try {
    await removeAdmin(healed.user.id, other.id);
  } catch (err) {
    removeBlocked = /protected operator/i.test(err.message || '');
  }
  assert.ok(removeBlocked, 'cannot remove protected operator');

  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('admin owner access checks passed');
})().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
