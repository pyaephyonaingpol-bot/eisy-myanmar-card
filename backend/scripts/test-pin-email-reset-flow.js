#!/usr/bin/env node
'use strict';

/**
 * Integration: optional registration PIN + email PIN reset + setPin.
 * Run: node backend/scripts/test-pin-email-reset-flow.js
 */
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDb } = require('../src/db');
const authService = require('../src/services/authService');
const User = require('../src/models/User');

async function latestOtp(email, purpose) {
  const db = getDb();
  return db.get(
    `SELECT * FROM otp_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    email,
    purpose
  );
}

async function run() {
  await initDb();
  const stamp = Date.now();
  const email = `pin-setup-${stamp}@example.com`;

  console.log('== register without PIN ==');
  await authService.sendRegistrationOtp(email);
  const regOtp = await latestOtp(email, 'register');
  assert.ok(regOtp?.otp_code, 'registration OTP stored');
  const reg = await authService.completeRegistration({
    email,
    otp: regOtp.otp_code,
    name: 'PIN Setup User',
    pin: null,
  });
  assert.strictEqual(reg.has_pin, false);
  assert.strictEqual(reg.needs_pin_setup, true);
  assert.ok(!reg.pin_token, 'no pin token until PIN is set');
  const created = await User.findByEmail(email);
  assert.ok(created);
  assert.ok(!created.pin_hash, 'user has no pin_hash yet');
  console.log('ok');

  console.log('== setPin after registration ==');
  const set = await authService.setPin(created.id, '654321', '654321');
  assert.strictEqual(set.has_pin, true);
  assert.ok(set.pin_token);
  const afterSet = await User.findById(created.id);
  assert.ok(afterSet.pin_hash, 'pin_hash persisted');
  console.log('ok');

  console.log('== email PIN reset ==');
  const sendPin = await authService.sendPinResetOtp(email);
  assert.ok(sendPin.message);
  const pinOtp = await latestOtp(email, 'reset_pin');
  assert.ok(pinOtp?.otp_code);
  const resetPin = await authService.completePinReset({
    email,
    otp: pinOtp.otp_code,
    pin: '112233',
    confirmPin: '112233',
    ipAddress: '127.0.0.1',
    deviceName: 'test',
    devicePlatform: 'web',
  });
  assert.strictEqual(resetPin.has_pin, true);
  assert.ok(resetPin.sessionToken);
  assert.ok(resetPin.pin_token);
  console.log('ok');

  console.log('== password reset APIs removed ==');
  assert.strictEqual(typeof authService.sendPasswordResetOtp, 'undefined');
  assert.strictEqual(typeof authService.completePasswordReset, 'undefined');
  console.log('ok');

  console.log('\nPIN email reset flow tests passed.');
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
