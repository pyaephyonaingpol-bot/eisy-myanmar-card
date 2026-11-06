#!/usr/bin/env node
'use strict';

/**
 * Pago card withdraw / block / unblock / terminate wiring.
 * Run: node backend/scripts/test-pago-card-lifecycle.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pagoCardService.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pagoWithdrawModal"'), 'withdraw modal present');
  assert.ok(doc.includes('id="pagoCardWithdrawOpenBtn"'), 'withdraw button present');
  assert.ok(doc.includes('id="pagoCardBlockBtn"'), 'block button present');
  assert.ok(doc.includes('id="pagoCardUnblockBtn"'), 'unblock button present');
  assert.ok(doc.includes('id="pagoTerminateModal"'), 'terminate modal present');
  assert.ok(doc.includes('id="pagoCardTerminateOpenBtn"'), 'terminate button present');
  const topupAt = doc.indexOf('id="pagoCardTopupOpenBtn"');
  const withdrawAt = doc.indexOf('id="pagoCardWithdrawOpenBtn"');
  assert.ok(topupAt > -1 && withdrawAt > topupAt, 'Withdraw sits after Top Up in actions');
}

assert.ok(css.includes('.pago-action-withdraw'), 'withdraw button styles');
assert.ok(css.includes('.pago-action-terminate'), 'terminate button styles');

assert.ok(dash.includes('openPagoWithdrawModal'), 'withdraw modal opener');
assert.ok(dash.includes('`/api/user/cards/${cardId}/withdraw`'), 'withdraw API wired');
assert.ok(dash.includes('`/api/user/cards/${cardId}/block`'), 'block API wired');
assert.ok(dash.includes('`/api/user/cards/${cardId}/unblock`'), 'unblock API wired');
assert.ok(dash.includes('`/api/user/cards/${cardId}/terminate`'), 'terminate API wired');
assert.ok(dash.includes('updatePagoCardLifecycleUi'), 'lifecycle button visibility');

assert.ok(i18n.includes("pago_withdraw_open: 'Withdraw'"), 'EN withdraw label');
assert.ok(i18n.includes("pago_terminate_balance_warn"), 'terminate warning copy');

assert.ok(routes.includes("router.post('/cards/:id/withdraw'"), 'withdraw route');
assert.ok(routes.includes("router.post('/cards/:id/block'"), 'block route');
assert.ok(routes.includes("router.post('/cards/:id/unblock'"), 'unblock route');
assert.ok(routes.includes("router.post('/cards/:id/terminate'"), 'terminate route');
assert.ok(routes.includes('withdrawPagoCard'), 'withdraw service used');
assert.ok(routes.includes('blockPagoCard'), 'block service used');

assert.ok(service.includes('MIN_CARD_REMAINING_USD = 5'), 'minimum remaining balance enforced');
assert.ok(service.includes('withdrawPagoCard'), 'withdraw service exported');
assert.ok(service.includes('.withdrawCard('), 'provider withdraw called');
assert.ok(service.includes('await creditUsdt(userId, withdrawAmount'), 'withdraw credits wallet');
assert.ok(service.includes('.blockCard('), 'provider block called');
assert.ok(service.includes('.terminateCard('), 'provider terminate called');

assert.ok(client.includes('/withdraw'), 'client withdraw path');
assert.ok(client.includes('publickey: config.apiKey'), 'auth headers on requests');
assert.ok(client.includes('/block'), 'client block path');
assert.ok(client.includes('/unblock'), 'client unblock path');
assert.ok(client.includes('/terminate'), 'client terminate path');

console.log('pago card lifecycle checks passed');
