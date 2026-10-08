#!/usr/bin/env node
'use strict';

/**
 * Guards for Pagocards 3DS webhook intake + dashboard display.
 * Run: node backend/scripts/test-pagocards-3ds-webhook.js
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
const webhookRoute = fs.readFileSync(path.join(root, 'backend/src/routes/webhook.js'), 'utf8');
const userRoutes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pago3dsWebhookService.js'), 'utf8');
const nextRoute = fs.readFileSync(path.join(root, 'app/api/webhook/pagocards/route.ts'), 'utf8');
const libTs = fs.readFileSync(path.join(root, 'lib/pagocardsWebhook.ts'), 'utf8');
const libJs = fs.readFileSync(path.join(root, 'lib/pagocardsWebhook.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'backend/migrations/071_pago_3ds_events.sql'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pago3dsPanel"'), '3DS panel present');
  assert.ok(doc.includes('id="pago3dsCode"'), '3DS code element present');
  assert.ok(doc.includes('id="pago3dsCopyBtn"'), '3DS copy button present');
  assert.ok(doc.includes('id="pago3dsRefreshBtn"'), 'Refresh Code button present');
  assert.ok(doc.includes('pago_3ds_refresh'), 'Refresh Code label key present');
  assert.ok(doc.includes('styles.css?v=20261008pago3dsRefresh'), 'CSS cache-bust bumped');
  assert.ok(doc.includes('dashboard.js?v=20261008pago3dsRefresh'), 'JS cache-bust bumped');
  assert.ok(doc.includes('i18n.js?v=20261008pago3dsRefresh'), 'i18n cache-bust bumped');
}

assert.ok(css.includes('.pago-3ds-panel'), '3DS panel styles');
assert.ok(css.includes('.pago-3ds-code'), '3DS code styles');

assert.ok(dash.includes('loadPago3dsEvents'), 'dashboard loads 3DS events');
assert.ok(dash.includes('renderPago3dsPanel'), 'dashboard renders 3DS panel');
assert.ok(dash.includes('startPago3dsPoll'), 'dashboard polls 3DS');
assert.ok(dash.includes("`/api/user/cards/${cardId}/3ds`") || dash.includes('/api/user/cards/${cardId}/3ds'), '3DS API path');
assert.ok(dash.includes('copyPago3dsCode'), 'copy 3DS code helper');
assert.ok(dash.includes('refreshPago3dsCode'), 'refresh 3DS code helper');
assert.ok(dash.includes('?refresh=1'), 'dashboard asks the API to refresh');
assert.ok(dash.includes('pago3dsRefreshBtn'), 'refresh button is bound');

assert.ok(i18n.includes('pago_3ds_heading:'), 'EN 3DS heading');
assert.ok(i18n.includes("pago_3ds_refresh: 'Refresh Code'"), 'EN Refresh Code label');
assert.ok(i18n.includes("pago_3ds_refresh: 'ကုဒ်ပြန်ယူမည်'"), 'MY Refresh Code label');
assert.ok(i18n.includes("pago_3ds_heading: '3DS Secure ကုဒ်'"), 'MY 3DS heading');

assert.ok(webhookRoute.includes("router.post('/pagocards'"), 'Express webhook registered');
assert.ok(webhookRoute.includes('handlePagocardsWebhook'), 'webhook uses service');

assert.ok(userRoutes.includes("router.get('/cards/3ds'"), 'user 3DS list route');
assert.ok(userRoutes.includes("router.get('/cards/:id/3ds'"), 'per-card 3DS route');
assert.ok(userRoutes.includes("router.post('/cards/3ds/:eventId/seen'"), 'mark-seen route');
// Static /cards/3ds must appear before /cards/:id
const idxList = userRoutes.indexOf("router.get('/cards/3ds'");
const idxId = userRoutes.indexOf("router.get('/cards/:id'");
assert.ok(idxList > -1 && idxId > -1 && idxList < idxId, '/cards/3ds before /cards/:id');

assert.ok(userRoutes.includes('refreshCard3dsFromProvider'), 'per-card route refreshes from Pago');
assert.ok(userRoutes.includes("req.query.refresh === '1'"), 'refresh query is honored');

assert.ok(service.includes('handlePagocardsWebhook'), 'service exports handler');
assert.ok(service.includes('refreshCard3dsFromProvider'), 'service pulls provider OTPs');
assert.ok(service.includes('listCardTransactions'), 'refresh uses documented transactions endpoint');
assert.ok(service.includes('getCardDetails'), 'refresh uses documented card endpoint');
assert.ok(service.includes('listUser3dsEvents'), 'service lists events');
assert.ok(service.includes('Pago3dsEvent'), 'service uses model');

const pagoClient = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');
assert.ok(pagoClient.includes('async function listCardTransactions'), 'Pago client lists transactions');
assert.ok(pagoClient.includes('/transactions?pageNum='), 'transactions path matches docs');

assert.ok(nextRoute.includes('export async function POST'), 'Next route POST');
assert.ok(nextRoute.includes('normalizePagocardsWebhook'), 'Next route normalizes');
assert.ok(nextRoute.includes('pagocardsWebhook.js'), 'Next route loads CJS helper');
assert.ok(libJs.includes('module.exports'), 'CJS helper uses module.exports');
assert.ok(libJs.includes('function normalizePagocardsWebhook'), 'CJS normalizer present');
assert.ok(libJs.includes('function collect3dsOtps'), 'CJS OTP collector present');
assert.ok(!/\bexport\s+function\b/.test(libJs), 'CJS helper has no ESM export function');
assert.ok(libTs.includes('module.exports'), 'TS helper uses module.exports (pagocard pattern)');
assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS pago_3ds_events'), 'migration table');

// Direct CJS require must work without strip-types / Unexpected token export.
const direct = require('../../lib/pagocardsWebhook.js');
assert.strictEqual(typeof direct.normalizePagocardsWebhook, 'function');

const { loadPagocardsWebhookLib } = require('../src/services/pago3dsWebhookService');
const { normalizePagocardsWebhook, summarizePagocardsEvent } = loadPagocardsWebhookLib();

const sample = {
  eventId: '977bdaf833a8423186d599cee720cf29',
  eventType: '3ds',
  userBankcardId: 1000001,
  verificationType: 'http',
  otp: '234562',
  authId: 'b47621b3601a4052951f8c5a8fe430b6',
  transactionAmount: '10',
  transactionCurrency: 'USD',
  merchantName: 'MYPAL',
  cardid: 'card_01m0evv599d37vm6dgb0rhd000',
};

const event = normalizePagocardsWebhook(sample);
assert.ok(event);
assert.strictEqual(event.eventId, sample.eventId);
assert.strictEqual(event.otp, '234562');
assert.strictEqual(event.cardId, sample.cardid);
assert.strictEqual(event.is3ds, true);
assert.ok(summarizePagocardsEvent(event).includes('otp=234562'));

const nested = normalizePagocardsWebhook({
  status: 'success',
  type: '3ds',
  data: {
    id: 'nested-auth-1',
    otp: '998877',
    amount: { amount: '25', currency: 'USD' },
    merchant: { name: 'Shop' },
    card: { cardId: 'card_nested' },
  },
});
assert.ok(nested);
assert.strictEqual(nested.otp, '998877');
assert.strictEqual(nested.cardId, 'card_nested');
assert.strictEqual(nested.merchantName, 'Shop');

assert.strictEqual(normalizePagocardsWebhook(null), null);
assert.strictEqual(normalizePagocardsWebhook({ foo: 1 }), null);


// Alternate field names / nested envelopes
const alt = normalizePagocardsWebhook({
  body: JSON.stringify({
    event_id: 'alt-1',
    type: '3ds',
    verification_code: '445566',
    card_id: 'card_alt_1',
    merchant_name: 'ALT',
  }),
});
assert.ok(alt);
assert.strictEqual(alt.otp, '445566');
assert.strictEqual(alt.cardId, 'card_alt_1');

const deep = normalizePagocardsWebhook({
  eventId: 'deep-1',
  eventType: 'virtualcard.3ds',
  data: { otp: '112233', card: { cardId: 'card_deep' } },
});
assert.ok(deep);
assert.strictEqual(deep.otp, '112233');
assert.strictEqual(deep.cardId, 'card_deep');
assert.ok(deep.is3ds);

const pulled = direct.collect3dsOtps({
  transactions: [
    {
      id: 'tx-mcc',
      merchant_mcc: '4121',
      merchant_name: 'Taxi',
      display_amount: '12.00',
    },
    {
      id: 'tx-otp',
      merchant_name: 'Shop',
      otp: '556677',
      transaction_amount: '9.50',
      transaction_currency: 'USD',
      card: { card_number: '4111111111111111', cvv: '123' },
    },
  ],
}, 'card_demo');
assert.strictEqual(pulled.length, 1);
assert.strictEqual(pulled[0].otp, '556677');
assert.strictEqual(pulled[0].eventId, 'tx-otp');
assert.strictEqual(pulled[0].merchantName, 'Shop');
assert.ok(pulled.every((item) => item.otp !== '123' && item.otp !== '4111111111111111'));

const ignored = direct.collect3dsOtps({
  data: { transactions: [{ id: 'tx-only', merchant_mcc: 4121, amount: 4121 }] },
}, 'card_demo');
assert.strictEqual(ignored.length, 0);

console.log('pagocards 3ds webhook checks passed');
