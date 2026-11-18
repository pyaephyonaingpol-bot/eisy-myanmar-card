#!/usr/bin/env node
'use strict';

/**
 * Guards: no hardcoded PIN/OTP/admin bypasses for production auth.
 * Run: node backend/scripts/test-auth-no-dev-bypass.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Source must not hardcode owner password or accept test PINs');
const cryptoSrc = fs.readFileSync(path.join(root, 'src/services/cryptoService.js'), 'utf8');
assert.ok(cryptoSrc.includes('return false'), 'isDefaultTestPin disabled');
assert.ok(cryptoSrc.includes('function isDefaultTestPin'), 'helper still exported as no-op');

const authSrc = fs.readFileSync(path.join(root, 'src/services/authService.js'), 'utf8');
assert.ok(!authSrc.includes('Use 123456 or 000000'), 'no test PIN unlock message');
assert.ok(!authSrc.includes('default test PIN 123456'), 'no default test PIN login message');
assert.ok(authSrc.includes('PIN_RESET_EMAIL_REQUIRED'), 'default reset disabled');

const ownerSrc = fs.readFileSync(path.join(root, 'src/services/ownerAdminAccount.js'), 'utf8');
assert.ok(!ownerSrc.includes('Love'), 'owner password not hardcoded');
assert.ok(!ownerSrc.includes('121518'), 'owner password digits not hardcoded');
assert.ok(ownerSrc.includes('ADMIN_OWNER_PASSWORD'), 'owner password from env');

const adminSrc = fs.readFileSync(path.join(root, 'src/services/adminAuthService.js'), 'utf8');
assert.ok(!adminSrc.includes('default test PIN 123456'), 'admin credential assert has no test PIN');
assert.ok(adminSrc.includes('randomBootstrapPinHash'), 'admin bootstrap uses random PIN hash');

const mwSrc = fs.readFileSync(path.join(root, 'src/middleware/auth.js'), 'utf8');
assert.ok(mwSrc.includes("ADMIN_DEV_BYPASS || '').toLowerCase() !== 'true'"), 'admin bypass opt-in only');

const devOtpSrc = fs.readFileSync(path.join(root, 'src/services/devOtp.js'), 'utf8');
assert.ok(devOtpSrc.includes('DEV_SHOW_OTP'), 'dev OTP opt-in');
assert.ok(devOtpSrc.includes('VERCEL'), 'dev OTP blocked on Vercel');
console.log('ok');

section('Runtime: isDefaultTestPin never accepts 123456/000000');
delete require.cache[require.resolve('../src/services/cryptoService')];
const { isDefaultTestPin, allowDefaultTestPinFixtures } = require('../src/services/cryptoService');
assert.strictEqual(isDefaultTestPin('123456'), false);
assert.strictEqual(isDefaultTestPin('000000'), false);
assert.strictEqual(isDefaultTestPin('00000'), false);
delete process.env.ALLOW_DEFAULT_TEST_PIN;
assert.strictEqual(allowDefaultTestPinFixtures(), false);
console.log('ok');

section('Runtime: PIN login rejects unset PIN (no auto 123456)');
const dbFile = path.join(os.tmpdir(), `eisy-auth-bypass-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_AUTH_TOKEN;

(async () => {
  const { initDb, closeDb } = require('../src/db');
  const User = require('../src/models/User');
  const authService = require('../src/services/authService');

  await initDb();
  const email = `no-pin-${Date.now()}@gmail.com`;
  const user = await User.create({
    name: 'No Pin',
    phone: `np${Date.now().toString().slice(-10)}`,
    email,
    pinHash: null,
  });
  assert.ok(user.id);

  let err;
  try {
    await authService.loginWithPin({ email, pin: '123456' });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'expected rejection');
  assert.strictEqual(err.code, 'PIN_NOT_SET');

  try {
    await authService.verifyPinCode(user.id, '000000');
    assert.fail('verifyPinCode should reject');
  } catch (e) {
    assert.strictEqual(e.code, 'PIN_NOT_SET');
  }

  try {
    await authService.resetPinToDefault(user.id);
    assert.fail('resetPinToDefault should reject');
  } catch (e) {
    assert.strictEqual(e.code, 'PIN_RESET_EMAIL_REQUIRED');
  }

  const { adminDevBypassEnabled } = require('../src/middleware/auth');
  delete process.env.ADMIN_DEV_BYPASS;
  delete process.env.ADMIN_API_KEY;
  assert.strictEqual(adminDevBypassEnabled(), false, 'bypass off without explicit flag');

  const { isDevOtpExposed } = require('../src/services/devOtp');
  delete process.env.DEV_SHOW_OTP;
  assert.strictEqual(isDevOtpExposed(), false, 'dev OTP off by default');

  const { applyOwnerAdminAccount } = require('../src/services/ownerAdminAccount');
  delete process.env.ADMIN_OWNER_PASSWORD;
  const skipped = await applyOwnerAdminAccount();
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual(skipped.reason, 'ADMIN_OWNER_PASSWORD_UNSET');

  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('ok');
  console.log('\nAuth no-dev-bypass checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
