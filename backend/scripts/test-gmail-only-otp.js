#!/usr/bin/env node
/**
 * Email OTP signup/login must reject non-Gmail domains.
 * Run: node backend/scripts/test-gmail-only-otp.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const {
    assertGmailOnlyForOtp,
    isGmailAddress,
    GMAIL_ONLY_OTP_MESSAGE,
    GMAIL_ONLY_OTP_CODE,
  } = require('../src/lib/gmailOnlyEmail');

  assert.strictEqual(isGmailAddress('User@Gmail.com'), true);
  assert.strictEqual(isGmailAddress('user@yahoo.com'), false);
  assert.strictEqual(isGmailAddress('user@mailinator.com'), false);
  assert.strictEqual(isGmailAddress('user@fldubai.com'), false);

  assert.strictEqual(assertGmailOnlyForOtp('ok@gmail.com'), 'ok@gmail.com');
  await assert.rejects(
    async () => assertGmailOnlyForOtp('temp@mailinator.com'),
    (err) => err.code === GMAIL_ONLY_OTP_CODE && err.message === GMAIL_ONLY_OTP_MESSAGE
  );
  await assert.rejects(
    async () => assertGmailOnlyForOtp('someone@yahoo.com'),
    (err) => err.message === GMAIL_ONLY_OTP_MESSAGE
  );
  await assert.rejects(
    async () => assertGmailOnlyForOtp('x@fldubai.com'),
    (err) => err.message === GMAIL_ONLY_OTP_MESSAGE
  );

  const dbFile = path.join(os.tmpdir(), `eisy-gmail-only-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  delete require.cache[require.resolve('../src/services/authService')];
  const authService = require('../src/services/authService');

  await assert.rejects(
    () => authService.sendRegistrationOtp('blocked@yahoo.com', '127.0.0.1'),
    (err) => err.code === 'GMAIL_ONLY_REQUIRED'
      && err.message === 'Gmail accounts only. Other email providers are not allowed for OTP.'
  );
  await assert.rejects(
    () => authService.sendLoginOtp('blocked@mailinator.com', '127.0.0.1'),
    (err) => err.code === 'GMAIL_ONLY_REQUIRED'
  );
  await assert.rejects(
    () => authService.sendPinResetOtp('blocked@fldubai.com', '127.0.0.1'),
    (err) => err.code === 'GMAIL_ONLY_REQUIRED'
  );

  const authJs = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');
  assert.ok(authJs.includes('assertGmailOnlyEmail'), 'frontend checks Gmail before OTP send');

  console.log('test-gmail-only-otp: OK');
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
