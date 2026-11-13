#!/usr/bin/env node
/**
 * Security lockdown: Pagocards proxy gate, Gmail-only auth, card-issue limits.
 * Run: node backend/scripts/test-card-issue-abuse-lockdown.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.chdir(path.join(__dirname, '..'));

const {
  PAGO_PROXY_ACCESS_HEADER,
  resolvePagoProxyAccessKey,
  requestHasValidPagoProxyAccess,
} = require('../../lib/pagoProxyAccess.cjs');

const {
  assertGmailOnlyForOtp,
  isGmailAddress,
  GMAIL_ONLY_OTP_CODE,
} = require('../src/lib/gmailOnlyEmail');

const {
  createSignupRateLimiter,
  createCardIssueRateLimiter,
} = require('../src/middleware/security');

process.env.PAGO_CARD_SECRET_KEY = 'sec-test-key-for-proxy-gate';
delete process.env.PAGO_PROXY_ACCESS_KEY;

const derived = resolvePagoProxyAccessKey();
assert.ok(derived.length === 64);
assert.strictEqual(
  derived,
  crypto.createHash('sha256').update('eisy-pago-proxy-v1:sec-test-key-for-proxy-gate').digest('hex')
);

assert.strictEqual(
  requestHasValidPagoProxyAccess({
    headers: { [PAGO_PROXY_ACCESS_HEADER]: derived },
  }),
  true
);
assert.strictEqual(
  requestHasValidPagoProxyAccess({ headers: {} }),
  false
);
assert.strictEqual(
  requestHasValidPagoProxyAccess({
    headers: { [PAGO_PROXY_ACCESS_HEADER]: 'wrong' },
  }),
  false
);

(async () => {
  assert.strictEqual(isGmailAddress('ok@gmail.com'), true);
  assert.strictEqual(isGmailAddress('bad@googlemail.com'), false);
  assert.strictEqual(isGmailAddress('x@fldubai.com'), false);
  assert.strictEqual(isGmailAddress('x@mailinator.com'), false);
  await assert.rejects(
    async () => assertGmailOnlyForOtp('abuse@yahoo.com'),
    (err) => err.code === GMAIL_ONLY_OTP_CODE
  );

  assert.strictEqual(typeof createSignupRateLimiter(), 'function');
  assert.strictEqual(typeof createCardIssueRateLimiter(), 'function');

  const proxySrc = fs.readFileSync(path.join(__dirname, '../src/routes/pagocardsProxy.js'), 'utf8');
  assert.ok(proxySrc.includes('PAGO_PROXY_UNAUTHORIZED'));
  assert.ok(proxySrc.includes('requestHasValidPagoProxyAccess'));

  const userSrc = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
  assert.ok(userSrc.includes('cardIssueLimiter'));
  assert.ok(userSrc.includes("'/cards/request', requireAuth, requireSensitive, cardIssueLimiter"));

  const authSrc = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.ok(authSrc.includes('requireGmailBodyEmail'));
  assert.ok(authSrc.includes('signupLimiter'));
  assert.ok(authSrc.includes("'/register/send-otp', signupLimiter, requireGmailBodyEmail"));

  const pagoSrc = fs.readFileSync(path.join(__dirname, '../src/services/pagoCardService.js'), 'utf8');
  assert.ok(pagoSrc.includes('CARD_LIMIT_REACHED'));
  assert.ok(pagoSrc.includes('assertGmailOnlyForOtp'));

  const clientSrc = fs.readFileSync(path.join(__dirname, '../../lib/pagocard.ts'), 'utf8');
  assert.ok(clientSrc.includes('PAGO_PROXY_ACCESS_HEADER'));
  assert.ok(clientSrc.includes('pagoAuthHeaders'));

  const tgSrc = fs.readFileSync(path.join(__dirname, '../src/services/telegram.js'), 'utf8');
  assert.ok(tgSrc.includes('notifyAdminSecurityAlert'));

  // Client attaches proxy gate key on outbound Pagocards calls.
  process.env.PAGO_CARD_API_KEY = 'pub-test-key';
  process.env.PAGO_CARD_SECRET_KEY = 'sec-test-key-for-proxy-gate';
  process.env.PAGO_CARD_API_BASE_URL = 'https://pagocards.example/api/v1/';
  const { loadPagoCardClient } = require('../src/services/loadPagoCardClient');
  const { createPagoCardClient } = loadPagoCardClient();
  let sawProxyHeader = false;
  const api = createPagoCardClient({
    fetchImpl: async (_url, init) => {
      const headers = init.headers || {};
      sawProxyHeader = headers[PAGO_PROXY_ACCESS_HEADER] === derived;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'success',
            data: {
              card_id: 'card_1',
              status: 'active',
              last_four: '4242',
              balance: { amount: 0, display_amount: 0, currency: 'USD' },
            },
          });
        },
      };
    },
  });
  await api.getCardDetails('card_1');
  assert.strictEqual(sawProxyHeader, true, 'Pagocards client must send proxy access key');

  console.log('test-card-issue-abuse-lockdown: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});