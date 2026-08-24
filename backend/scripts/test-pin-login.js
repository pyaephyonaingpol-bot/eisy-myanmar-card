#!/usr/bin/env node
'use strict';

/**
 * Regression: PIN login must load the Turso/LibSQL User model before PIN checks.
 * Guards against "User is not defined" after refactors that drop the User require.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const assert = require('assert');
const { initDb, closeDb, getDb } = require('../src/db');
const authService = require('../src/services/authService');
const User = require('../src/models/User');
const { hashPin } = require('../src/services/cryptoService');

async function expectReject(fn, code) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err, `expected rejection with code ${code}`);
  assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
  assert(
    !/User is not defined/i.test(String(err.message || '')),
    'must not surface ReferenceError "User is not defined"'
  );
  return err;
}

async function run() {
  await initDb();

  await expectReject(
    () => authService.loginWithPin({ email: 'nobody-pin-test@example.com', pin: '123456' }),
    'USER_NOT_FOUND'
  );
  console.log('missing-user OK');

  await expectReject(
    () => authService.loginWithPin({ email: '', pin: '123456' }),
    'EMAIL_REQUIRED'
  );
  console.log('invalid-email OK');

  await expectReject(
    () => authService.loginWithPin({ email: 'a@b.com', pin: '12' }),
    'INVALID_PIN_FORMAT'
  );
  console.log('invalid-pin-format OK');

  const email = `pin-login-fix-${Date.now()}@example.com`;
  const created = await User.create({
    name: 'PIN Login Fix',
    phone: `e${Date.now().toString().slice(-10)}`,
    email,
    pinHash: hashPin('432156'),
  });
  assert(created?.id, 'user create failed');

  const ok = await authService.loginWithPin({ email, pin: '432156' });
  assert(ok?.user?.id, 'session user missing');
  assert(ok?.sessionToken, 'sessionToken missing');
  assert.strictEqual(ok.user.email, email);
  console.log('PIN login success OK', ok.user.id);

  await expectReject(
    () => authService.loginWithPin({ email, pin: '999999' }),
    'INVALID_PIN'
  );
  console.log('wrong-pin OK');

  const db = getDb();
  await db.run('DELETE FROM user_sessions WHERE user_id = ?', created.id).catch(() => {});
  await db.run('DELETE FROM users WHERE id = ?', created.id);

  console.log('PIN LOGIN TESTS PASSED');
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
