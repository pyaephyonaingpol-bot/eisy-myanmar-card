#!/usr/bin/env node
'use strict';

/**
 * Static + local DB checks for ADMIN_EMAIL env → super_admin mapping.
 * Run: npm run test:admin-env-ensure
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

function section(t) { console.log(`\n== ${t} ==`); }

section('source wiring');
const service = fs.readFileSync(path.join(ROOT, 'src/services/adminAuthService.js'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');

assert.ok(service.includes('async function ensureEnvSuperAdmin'), 'ensureEnvSuperAdmin defined');
assert.ok(service.includes('async function getEnvAdminMappingStatus'), 'mapping status helper');
assert.ok(routes.includes("/auth/ensure-env-admin"), 'ensure-env-admin route');
assert.ok(routes.includes('env_admin'), 'auth/status exposes env_admin');
assert.ok(routes.includes('database:'), 'auth/status exposes database identity');
assert.ok(index.includes('ensureEnvSuperAdmin'), 'boot calls ensureEnvSuperAdmin');
assert.ok(!html.includes(', 8000)'), 'splash no longer waits 8s');
assert.ok(html.includes('dismissAdminSplash') || html.includes('1500'), 'faster splash dismiss');
console.log('ok');

section('ensureEnvSuperAdmin upserts ADMIN_EMAIL as super_admin');
const dbFile = path.join(os.tmpdir(), `eisy-admin-env-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'ops-admin@example.com';
process.env.ADMIN_PASSWORD = 'TestAdmin!23456';
process.env.ADMIN_NAME = 'Ops Admin';
delete process.env.DATABASE_AUTH_TOKEN;

const { initDb, closeDb } = require('../src/db');
const User = require('../src/models/User');
const {
  ensureEnvSuperAdmin,
  getEnvAdminMappingStatus,
  loginAdmin,
} = require('../src/services/adminAuthService');

(async () => {
  await initDb();
  const first = await ensureEnvSuperAdmin({ source: 'test' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.created, true);
  assert.strictEqual(first.user.email, 'ops-admin@example.com');
  assert.strictEqual(first.user.admin_role, 'super_admin');

  const map = await getEnvAdminMappingStatus();
  assert.strictEqual(map.mapped, true);
  assert.strictEqual(map.is_super_admin, true);

  // Second call is idempotent and still refreshes password/role
  const second = await ensureEnvSuperAdmin({ source: 'test-again' });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.promoted, false);

  const session = await loginAdmin({
    email: 'ops-admin@example.com',
    password: 'TestAdmin!23456',
  });
  assert.ok(session.sessionToken, 'can login with env password after ensure');

  // Promote a normal user email that already exists without admin_role
  const plain = await User.create({
    name: 'Plain',
    phone: '09999999999',
    email: 'plain-user@example.com',
    pinHash: null,
  });
  process.env.ADMIN_EMAIL = 'plain-user@example.com';
  process.env.ADMIN_PASSWORD = 'TestAdmin!23456';
  const promoted = await ensureEnvSuperAdmin({ source: 'promote' });
  assert.strictEqual(promoted.ok, true);
  assert.strictEqual(promoted.created, false);
  assert.strictEqual(promoted.promoted, true);
  assert.strictEqual(promoted.user.admin_role, 'super_admin');
  assert.strictEqual(promoted.user.id, plain.id);

  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('ok');
  console.log('\nAdmin env ensure checks passed.');
})().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
