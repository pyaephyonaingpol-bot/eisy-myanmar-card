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

async function registerWithOtp(email, { name, phone, pin = '123456', termsAccepted = true } = {}) {
  const sent = await authService.sendRegistrationOtp(email);
  const otp = sent.dev_otp || sent.otp || process.env.MASTER_TEST_OTP;
  assert(otp, 'expected a usable OTP from sendRegistrationOtp');
  return authService.completeRegistration({
    email,
    otp,
    name,
    phone,
    pin,
    termsAccepted,
  });
}

async function run() {
  await initDb();

  const stamp = Date.now();
  const emailA = `reg-a-${stamp}@gmail.com`;
  const emailB = `reg-b-${stamp}@gmail.com`;
  const phoneA = `09${String(stamp).slice(-9)}`;

  const userA = (await registerWithOtp(emailA, { name: 'Reg A', phone: phoneA })).user;
  assert.strictEqual(userA.email, emailA, 'first registration should succeed');
  assert.strictEqual(Number(userA.terms_accepted), 1, 'terms_accepted persisted');
  assert.ok(userA.terms_accepted_at, 'terms_accepted_at persisted');
  assert.ok(userA.terms_version, 'terms_version persisted');
  assert.strictEqual(userA.terms_version, authService.TERMS_VERSION);

  const storedA = await User.findByEmail(emailA);
  assert.strictEqual(storedA.phone, phoneA, 'explicit phone should be stored');

  // Similar local-part emails must not collide on synthetic phone
  const similarEmail = emailA.replace('reg-a', 'reg.a');
  if (similarEmail !== emailA) {
    const userSimilar = (await registerWithOtp(similarEmail, { name: 'Reg Similar' })).user;
    assert.strictEqual(userSimilar.email, similarEmail);
    const storedSimilar = await User.findByEmail(similarEmail);
    assert.ok(storedSimilar.phone, 'synthetic phone should be stored');
    assert.notStrictEqual(
      storedA.phone,
      storedSimilar.phone,
      'synthetic phones must be unique from explicit phones'
    );
  }

  let duplicatePhoneErr;
  try {
    await registerWithOtp(emailB, { name: 'Reg B', phone: phoneA });
  } catch (err) {
    duplicatePhoneErr = err;
  }
  assert(duplicatePhoneErr, 'duplicate phone should fail');
  assert.strictEqual(duplicatePhoneErr.code, 'PHONE_ALREADY_REGISTERED');

  let duplicateEmailErr;
  try {
    await authService.sendRegistrationOtp(emailA);
  } catch (err) {
    duplicateEmailErr = err;
  }
  assert(duplicateEmailErr, 'duplicate email should fail');
  assert.ok(
    /already registered/i.test(String(duplicateEmailErr.message)),
    'duplicate email error should mention already registered'
  );
  assert(!String(duplicateEmailErr.message).includes('SQLITE'), 'errors must not leak SQLITE text');

  // Terms acceptance is required
  const emailTerms = `reg-terms-${stamp}@gmail.com`;
  const sent = await authService.sendRegistrationOtp(emailTerms);
  const otp = sent.dev_otp || sent.otp || process.env.MASTER_TEST_OTP;
  let termsErr;
  try {
    await authService.completeRegistration({
      email: emailTerms,
      otp,
      name: 'No Terms',
      pin: '123456',
      termsAccepted: false,
    });
  } catch (err) {
    termsErr = err;
  }
  assert(termsErr, 'registration without terms should fail');
  assert.strictEqual(termsErr.code, 'TERMS_NOT_ACCEPTED');

  const notCreated = await User.findByEmail(emailTerms);
  assert.ok(!notCreated, 'user must not be created when terms are declined');

  const accepted = (await registerWithOtp(emailTerms, { name: 'With Terms' })).user;
  assert.strictEqual(Number(accepted.terms_accepted), 1);
  const row = await User.findByEmail(emailTerms);
  assert.strictEqual(Number(row.terms_accepted), 1);
  assert.ok(row.terms_accepted_at);
  assert.strictEqual(row.terms_version, authService.TERMS_VERSION);

  console.log('AUTH REGISTRATION TESTS PASSED');
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
