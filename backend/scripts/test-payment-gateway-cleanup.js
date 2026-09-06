#!/usr/bin/env node
/**
 * Assert the former NOWPayments gateway integration is fully removed.
 * Run: node backend/scripts/test-payment-gateway-cleanup.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const BACKEND = path.join(__dirname, '..');

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('deleted integration files');
const bannedFiles = [
  'backend/src/services/nowPaymentsService.js',
  'backend/src/services/nowPaymentsPayoutService.js',
  'server/routes/nowpayments.js',
  'backend/docs/NOWPAYMENTS.md',
  'scripts/sync-nowpayments-env-to-vercel.sh',
  'supabase/nowpayments_transactions.sql',
  'backend/scripts/test-nowpayments-ipn.js',
  'backend/scripts/test-nowpayments-payout.js',
  'backend/scripts/test-nowpayments-payout-config.js',
];
for (const rel of bannedFiles) {
  assert.ok(!exists(rel), `expected deleted: ${rel}`);
}
console.log('ok');

section('express mounts / create-payment');
const indexJs = read('backend/src/index.js');
assert.ok(!indexJs.includes('/api/nowpayments'));
assert.ok(!indexJs.includes('create-payment'));
assert.ok(!indexJs.includes('nowPayments'));
assert.ok(!indexJs.includes('NOWPayments'));
console.log('ok');

section('admin / withdrawal routes');
const admin = read('backend/src/routes/admin.js');
const withdrawal = read('backend/src/routes/withdrawal.js');
assert.ok(!/nowpayments/i.test(admin));
assert.ok(!/NOWPayments/.test(admin));
assert.ok(!/nowpayments/i.test(withdrawal));
console.log('ok');

section('frontend surfaces');
for (const rel of [
  'backend/public/admin.js',
  'backend/public/admin.html',
  'backend/public/dashboard.js',
  'backend/public/i18n.js',
  'backend/public/src/services/depositApi.js',
]) {
  const text = read(rel);
  assert.ok(!/nowpayments/i.test(text), rel);
  assert.ok(!/NOWPayments/.test(text), rel);
  assert.ok(!/create-payment/.test(text), rel);
}
console.log('ok');

section('package scripts / vercel / env examples');
const pkg = JSON.parse(read('backend/package.json'));
const bannedScripts = Object.keys(pkg.scripts || {}).filter((k) =>
  /^test:nowpayments-(ipn|payout|payout-config)$/.test(k)
);
assert.strictEqual(bannedScripts.length, 0, 'legacy nowpayments npm scripts must be removed');
assert.ok(!Object.values(pkg.scripts || {}).some((v) => /test-nowpayments-(ipn|payout)/.test(String(v))));
assert.ok(!read('vercel.json').includes('nowpayments'));
assert.ok(!/NOWPAYMENTS/.test(read('.env.example')));
assert.ok(!/NOWPAYMENTS/.test(read('backend/.env.example')));
console.log('ok');

section('cors headers');
assert.ok(!/nowpayments/i.test(read('backend/src/corsOptions.js')));
console.log('ok');

console.log('\nPayment gateway cleanup checks passed.');
