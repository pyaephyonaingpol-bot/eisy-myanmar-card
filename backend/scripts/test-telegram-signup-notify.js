#!/usr/bin/env node
'use strict';

/**
 * New-user Telegram admin alert.
 * Run: node backend/scripts/test-telegram-signup-notify.js
 */
const path = require('path');
const os = require('os');
const assert = require('assert');

const dbFile = path.join(os.tmpdir(), `eisy-signup-telegram-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.DEV_SHOW_OTP = '1';
delete process.env.RESEND_API_KEY;
delete process.env.SUPABASE_JWT_SECRET;
delete process.env.JWT_SECRET_SUPABASE;
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|TURSO|PAGO/i.test(key)) delete process.env[key];
}
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.ADMIN_GROUP_ID;
delete process.env.TELEGRAM_ADMIN_CHAT_ID;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.TELEGRAM_SUPPORT_CHAT_ID;

const { initDb, closeDb } = require('../src/db');
const { loadTelegramClient } = require('../src/services/loadTelegramClient');
const { setSupabaseClientForTests, resetSupabaseClientForTests } = require('../src/lib/supabase');

const TOKEN = '000000:TESTSIGNUP';
const GROUP_ID = '-100555';
const FALLBACK_CHAT = '-100777';

function telegramCalls(sent) {
  return sent.filter((entry) => String(entry.url).includes('api.telegram.org/bot') && String(entry.url).endsWith('/sendMessage'));
}

async function flushNotify() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function main() {
  const telegram = loadTelegramClient();
  assert.strictEqual(typeof telegram.notifyAdminNewUser, 'function');
  assert.strictEqual(typeof telegram.sendAdminMessage, 'function');

  console.log('== helper prefers ADMIN_GROUP_ID and skips when unset ==');
  const direct = [];
  const fetchImpl = async (url, init) => {
    direct.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: direct.length } }),
    };
  };

  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.ADMIN_GROUP_ID = GROUP_ID;
  process.env.TELEGRAM_ADMIN_CHAT_ID = FALLBACK_CHAT;
  const preferred = await telegram.notifyAdminNewUser({
    user: { name: 'New Person', email: 'new.person@example.com' },
    method: 'email_otp',
    fetchImpl,
    token: TOKEN,
  });
  assert.strictEqual(preferred.ok, true);
  assert.strictEqual(direct.length, 1);
  assert.strictEqual(direct[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.strictEqual(direct[0].body.chat_id, GROUP_ID);
  assert.ok(direct[0].body.text.includes('new.person@example.com'));
  assert.ok(direct[0].body.text.includes('Email OTP'));
  assert.ok(direct[0].body.text.includes('New Person'));

  process.env.ADMIN_GROUP_ID = '';
  const fallback = await telegram.notifyAdminNewUser({
    user: { name: 'Fallback Person', email: 'fallback.person@example.com' },
    method: 'google',
    fetchImpl,
  });
  assert.strictEqual(fallback.ok, true);
  assert.strictEqual(direct[1].body.chat_id, FALLBACK_CHAT);
  assert.ok(direct[1].body.text.includes('Google'));

  process.env.ADMIN_GROUP_ID = 'your_admin_group_id_here';
  const placeholder = await telegram.notifyAdminNewUser({
    user: { name: 'Placeholder', email: 'placeholder.person@example.com' },
    method: 'email_otp',
    fetchImpl,
  });
  assert.strictEqual(placeholder.ok, true);
  assert.strictEqual(direct[2].body.chat_id, FALLBACK_CHAT);

  delete process.env.ADMIN_GROUP_ID;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_SUPPORT_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  const beforeSkip = direct.length;
  const skipped = await telegram.notifyAdminNewUser({
    user: { name: 'Skipped', email: 'skipped.person@example.com' },
    method: 'email_otp',
    fetchImpl,
  });
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual(direct.length, beforeSkip);
  console.log('ok');

  console.log('\n== email signup notifies once; duplicate does not ==');
  await initDb();
  const authService = require('../src/services/authService');
  const sent = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 5000 + sent.length } }),
    };
  };

  const email = `signup-telegram-${Date.now()}@example.com`;
  const issued = await authService.sendRegistrationOtp(email, '127.0.0.1');
  const registered = await authService.completeRegistration({
    email,
    otp: issued.dev_otp,
    name: 'Signup Tester',
    pin: '123456',
    ipAddress: '127.0.0.1',
  });
  assert.strictEqual(registered.user.email, email);
  await flushNotify();
  assert.strictEqual(telegramCalls(sent).length, 0, 'unset telegram must not send');

  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.ADMIN_GROUP_ID = GROUP_ID;
  const email2 = `signup-telegram-2-${Date.now()}@example.com`;
  const issued2 = await authService.sendRegistrationOtp(email2, '127.0.0.1');
  const registered2 = await authService.completeRegistration({
    email: email2,
    otp: issued2.dev_otp,
    name: 'Signup Tester Two',
    pin: '123456',
    ipAddress: '127.0.0.1',
  });
  assert.strictEqual(registered2.user.email, email2);
  await flushNotify();
  const signupSends = telegramCalls(sent);
  assert.strictEqual(signupSends.length, 1);
  assert.strictEqual(signupSends[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.strictEqual(signupSends[0].body.chat_id, GROUP_ID);
  assert.ok(signupSends[0].body.text.includes(email2));
  assert.ok(signupSends[0].body.text.includes('Email OTP'));
  assert.ok(signupSends[0].body.text.includes('Signup Tester Two'));

  const OtpCode = require('../src/models/OtpCode');
  const duplicateExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await OtpCode.create({
    email: email2,
    otpCode: '654321',
    purpose: 'register',
    expiresAt: duplicateExpiry,
  });
  let duplicateErr;
  try {
    await authService.completeRegistration({
      email: email2,
      otp: '654321',
      name: 'Duplicate',
      pin: '123456',
    });
  } catch (err) {
    duplicateErr = err;
  }
  assert.ok(duplicateErr);
  assert.strictEqual(duplicateErr.code, 'EMAIL_ALREADY_REGISTERED');
  await flushNotify();
  assert.strictEqual(telegramCalls(sent).length, 1, 'duplicate signup must not notify');
  console.log('ok');

  console.log('\n== Google sign-up notifies only the new account ==');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE5MDAwMDAwMDB9.signaturepaddingpaddingpadding';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTkwMDAwMDAwMH0.signaturepaddingpaddingpadding';
  const googleEmail = `google.signup.${Date.now()}@example.com`;
  resetSupabaseClientForTests();
  setSupabaseClientForTests({
    auth: {
      async getUser(token) {
        assert.strictEqual(token, 'valid-google-access-token');
        return {
          data: {
            user: {
              id: 'supabase-google-signup-1',
              email: googleEmail,
              user_metadata: { full_name: 'Google Signup' },
            },
          },
          error: null,
        };
      },
    },
  });

  const beforeGoogle = telegramCalls(sent).length;
  const created = await authService.loginWithGoogleOAuth({
    accessToken: 'valid-google-access-token',
    ipAddress: '127.0.0.1',
    deviceName: 'Test',
    devicePlatform: 'web',
  });
  assert.strictEqual(created.created, true);
  await flushNotify();
  const googleSends = telegramCalls(sent).slice(beforeGoogle);
  assert.strictEqual(googleSends.length, 1);
  assert.strictEqual(googleSends[0].body.chat_id, GROUP_ID);
  assert.ok(googleSends[0].body.text.includes(googleEmail));
  assert.ok(googleSends[0].body.text.includes('Google'));
  assert.ok(!googleSends[0].body.text.includes('valid-google-access-token'));

  const again = await authService.loginWithGoogleOAuth({
    accessToken: 'valid-google-access-token',
    ipAddress: '127.0.0.1',
    deviceName: 'Test',
    devicePlatform: 'web',
  });
  assert.strictEqual(again.created, false);
  await flushNotify();
  assert.strictEqual(telegramCalls(sent).length, beforeGoogle + 1, 'existing Google user must not notify');
  console.log('ok');

  global.fetch = previousFetch;
  resetSupabaseClientForTests();
  await closeDb();
  console.log('\nTelegram signup notify checks passed.');
}

main().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
