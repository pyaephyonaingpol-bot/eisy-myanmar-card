#!/usr/bin/env node
'use strict';

/**
 * OTP / PIN-reset email dispatch must not block auth API responses on Resend RTT.
 * Run: node scripts/test-otp-email-async.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

async function main() {
  console.log('== Static wiring ==');
  const emailSvc = read('src/services/emailService.js');
  const authSvc = read('src/services/authService.js');

  assert.ok(emailSvc.includes('dispatchOtpEmail'), 'dispatchOtpEmail exported');
  assert.ok(emailSvc.includes('postResendEmail'), 'direct Resend HTTP helper');
  assert.ok(emailSvc.includes('AbortController'), 'Resend timeout via AbortController');
  assert.ok(emailSvc.includes('api.resend.com/emails'), 'Resend REST endpoint');
  assert.ok(!emailSvc.includes("require('resend')"), 'OTP path must not use blocking Resend SDK');

  assert.ok(authSvc.includes('dispatchOtpEmail'), 'auth uses dispatchOtpEmail');
  assert.ok(!/await sendOtpEmail\(/.test(authSvc), 'auth must not await sendOtpEmail');
  assert.ok(authSvc.includes("purpose: 'reset_pin'"), 'PIN reset dispatches email');
  assert.ok(authSvc.includes('email_queued: true'), 'API reports email queued');
  console.log('ok');

  console.log('== Slow Resend must not block PIN-reset / OTP handlers ==');
  const dbFile = path.join(os.tmpdir(), `eisy-otp-email-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 're_test_key_for_async_dispatch';
  process.env.RESEND_TIMEOUT_MS = '2500';
  process.env.RESEND_OTP_RETRIES = '0';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Slow Resend: hang until aborted / resolved late.
  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    fetchCalls += 1;
    assert.ok(String(url).includes('api.resend.com'), `unexpected fetch url: ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (opts.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: `email_test_${fetchCalls}` }),
    };
  };

  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');
  const authService = require('../src/services/authService');
  const { awaitPendingOtpEmails } = require('../src/services/emailService');

  const email = `otp-async-${Date.now()}@example.com`;
  const user = await User.create({
    name: 'OTP Async',
    phone: `09${String(Date.now()).slice(-8)}`,
    email,
    pinHash: null,
  });
  assert.ok(user?.id);

  const t0 = Date.now();
  const pinReset = await authService.sendPinResetOtp(email, '127.0.0.1');
  const pinElapsed = Date.now() - t0;
  assert.strictEqual(pinReset.email_queued, true);
  assert.ok(pinElapsed < 400, `PIN reset OTP handler blocked on Resend (${pinElapsed}ms)`);
  console.log(`PIN reset OTP returned in ${pinElapsed}ms (queued)`);

  const t1 = Date.now();
  const loginOtp = await authService.sendLoginOtp(email, '127.0.0.1');
  const loginElapsed = Date.now() - t1;
  assert.strictEqual(loginOtp.email_queued, true);
  assert.ok(loginElapsed < 400, `Login OTP handler blocked on Resend (${loginElapsed}ms)`);
  console.log(`Login OTP returned in ${loginElapsed}ms (queued)`);

  const results = await awaitPendingOtpEmails();
  assert.ok(fetchCalls >= 2, `expected Resend fetches, got ${fetchCalls}`);
  assert.ok(results.every((r) => r.sent === true), 'background sends should succeed');
  console.log(`Background Resend completed (${fetchCalls} calls)`);

  global.fetch = originalFetch;
  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('OTP email async dispatch — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
