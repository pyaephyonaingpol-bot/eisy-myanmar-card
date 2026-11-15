#!/usr/bin/env node
'use strict';

/**
 * Card speed + tx history modal + 3DS dual delivery guards.
 * Run: node backend/scripts/test-pago-3ds-tx-modal.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

console.log('== Transaction history is modal-only ==');
for (const docName of ['backend/public/index.html', 'backend/public/instant.html']) {
  const doc = read(docName);
  assert.ok(doc.includes('id="pagoTxOpenBtn"'), `${docName}: open history button`);
  assert.ok(doc.includes('id="pagoTxModal"'), `${docName}: history modal`);
  assert.ok(doc.includes('id="pagoTxList"'), `${docName}: list lives in modal`);
  assert.ok(!/<section[^>]*id="pagoTxPanel"/.test(doc), `${docName}: inline tx panel removed`);
}
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('openPagoTxModal'), 'dashboard opens history modal');
assert.ok(dash.includes('closePagoTxModal'), 'dashboard closes history modal');
assert.ok(
  !/loadPago3dsEvents\(card\.id[\s\S]{0,80}loadPagoCardTransactions\(card\.id\)/.test(dash),
  'opening a card must not auto-fetch transactions'
);
assert.ok(dash.includes('PAGO_3DS_POLL_MS: 5000'), 'faster 3DS poll');
assert.ok(dash.includes('PAGO_3DS_PROVIDER_EVERY'), 'periodic provider 3DS scan');
assert.ok(dash.includes('timeoutMs: 10000'), 'faster cards list timeout');
console.log('ok');

console.log('\n== 3DS email + push delivery ==');
const webhook = read('backend/src/services/pago3dsWebhookService.js');
assert.ok(webhook.includes('deliver3dsNotifications'), 'shared 3DS deliver helper');
assert.ok(webhook.includes('dispatch3dsCodeEmail'), 'emails 3DS codes');
assert.ok(webhook.includes('notifyUserPush'), 'pushes 3DS codes');
assert.ok(
  webhook.includes('deliver3dsNotifications({') && webhook.includes('imported += 1'),
  'provider refresh also emails newly imported OTPs'
);

const email = read('backend/src/services/emailService.js');
assert.ok(email.includes('send3dsCodeEmail'), 'send3dsCodeEmail export');
assert.ok(email.includes('dispatch3dsCodeEmail'), 'dispatch3dsCodeEmail export');
assert.ok(email.includes('3D Secure verification code'), '3DS email copy');

const i18n = read('backend/public/i18n.js');
assert.ok(i18n.includes("pago_tx_open: 'View transaction history'"), 'EN open CTA');
assert.ok(i18n.includes("pago_tx_open: 'အသုံးစရိတ် မှတ်တမ်း ကြည့်မည်'"), 'MY open CTA');
console.log('ok');

console.log('\nPago 3DS + tx modal checks passed.');
