#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const assert = require('assert');
const { initDb, closeDb } = require('../src/db');
const authService = require('../src/services/authService');
const User = require('../src/models/User');

async function run() {
  await initDb();

  const emailA = `reg-a-${Date.now()}@gmail.com`;
  const emailB = `reg-b-${Date.now()}@gmail.com`;

  await authService.sendRegistrationOtp(emailA);
  const userA = (await authService.completeRegistration({
    email: emailA,
    otp: '123456',
    name: 'Reg A',
    pin: '123456',
  })).user;
  assert(userA.email === emailA, 'first registration should succeed');

  // Similar local-part emails must not collide on synthetic phone
  const similarEmail = emailA.replace('reg-a', 'reg.a');
  if (similarEmail !== emailA) {
    await authService.sendRegistrationOtp(similarEmail);
    const userSimilar = (await authService.completeRegistration({
      email: similarEmail,
      otp: '123456',
      name: 'Reg Similar',
      pin: '123456',
    })).user;
    assert.notStrictEqual(userA.phone, userSimilar.phone, 'synthetic phones must be unique');
  }

  await authService.sendRegistrationOtp(emailB);
  let duplicatePhoneErr;
  try {
    await authService.completeRegistration({
      email: emailB,
      otp: '123456',
      name: 'Reg B',
      phone: userA.phone,
      pin: '123456',
    });
  } catch (err) {
    duplicatePhoneErr = err;
  }
  assert(duplicatePhoneErr, 'duplicate phone should fail');
  assert.strictEqual(duplicatePhoneErr.code, 'PHONE_ALREADY_REGISTERED');

  let duplicateEmailErr;
  try {
    await authService.completeRegistration({
      email: emailA,
      otp: '123456',
      name: 'Dup Email',
      pin: '123456',
    });
  } catch (err) {
    duplicateEmailErr = err;
  }
  assert(duplicateEmailErr, 'duplicate email should fail');
  assert.strictEqual(duplicateEmailErr.code, 'EMAIL_ALREADY_REGISTERED');
  assert(!String(duplicateEmailErr.message).includes('SQLITE'), 'errors must not leak SQLITE text');

  console.log('AUTH REGISTRATION TESTS PASSED');
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
