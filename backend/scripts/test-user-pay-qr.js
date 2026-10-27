#!/usr/bin/env node
'use strict';

/**
 * User Pay QR parse/build + UI wiring smoke.
 * Run: node backend/scripts/test-user-pay-qr.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const {
  buildUserReceiveQrPayload,
  parseUserPayQrPayload,
} = require('../src/services/userPayQrService');

assert.ok(buildUserReceiveQrPayload({ userId: 7, email: 'Pay@Example.com' }).includes('eisy://pay?'));
assert.ok(buildUserReceiveQrPayload({ userId: 7, email: 'Pay@Example.com' }).includes('email=pay%40example.com'));

const link = 'eisy://pay?v=1&uid=9&email=peer@example.com&amount=12.5';
const parsed = parseUserPayQrPayload(link);
assert.strictEqual(parsed.to_user_id, 9);
assert.strictEqual(parsed.to_email, 'peer@example.com');
assert.strictEqual(parsed.amount_usdt, 12.5);

const json = parseUserPayQrPayload(JSON.stringify({
  type: 'eisy_user_pay',
  email: 'a@b.co',
  amount_usdt: 3,
}));
assert.strictEqual(json.to_email, 'a@b.co');
assert.strictEqual(json.amount_usdt, 3);

const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
const route = fs.readFileSync(path.join(ROOT, 'src/routes/usdtWallet.js'), 'utf8');

const instantHtml = fs.readFileSync(path.join(ROOT, 'public/instant.html'), 'utf8');
assert.ok(indexHtml.includes('id="btnNavOpenUserPay"'), 'Pay nav button (index)');
assert.ok(instantHtml.includes('id="btnNavOpenUserPay"'), 'Pay nav button (instant)');
assert.ok(indexHtml.includes('id="userPayModal"'), 'Pay modal shell');
assert.ok(
  /id="userPayModal"[^>]*\bhidden\b/.test(indexHtml),
  'Pay modal uses native hidden by default'
);
assert.ok(dash.includes('_setUserPayModalVisible'), 'Pay modal visibility helper');
assert.ok(dash.includes('is-open'), 'Pay modal is-open toggle');
assert.ok(dash.includes('openUserPayModal'), 'dashboard opens Pay modal');
assert.ok(dash.includes('_userPayGuard'), 'in-flight guard for Pay submit');
assert.ok(dash.includes('/api/user/usdt-wallet/pay/parse'), 'parse Pay QR API');
assert.ok(dash.includes('/api/user/usdt-wallet/pay/receive-qr'), 'receive QR API');
assert.ok(route.includes("'/pay/receive-qr'"), 'receive-qr route');
assert.ok(route.includes("'/pay/parse'"), 'pay parse route');

console.log('test-user-pay-qr: OK');
