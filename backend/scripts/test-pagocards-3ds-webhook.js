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
const libCjs = fs.readFileSync(path.join(root, 'lib/pagocardsWebhook.cjs'), 'utf8');
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
assert.ok(nextRoute.includes('pagocardsWebhook.cjs'), 'Next route loads .cjs helper');
assert.ok(libCjs.includes('module.exports'), 'CJS helper uses module.exports');
assert.ok(libCjs.includes('function normalizePagocardsWebhook'), 'CJS normalizer present');
assert.ok(libCjs.includes('function collect3dsOtps'), 'CJS OTP collector present');
assert.ok(libCjs.includes('function mapWebhookCardStatus'), 'status mapper present');
assert.ok(!/\bexport\s+function\b/.test(libCjs), 'CJS helper has no ESM export function');
assert.ok(libJs.includes("require('./pagocardsWebhook.cjs')"), 'JS re-exports CJS implementation');
assert.ok(!/\bexport\s+function\b/.test(libJs), 'JS re-export has no ESM export function');
assert.ok(libTs.includes('module.exports'), 'TS helper uses module.exports (pagocard pattern)');
assert.ok(libTs.includes("require('./pagocardsWebhook.cjs')"), 'TS loads .cjs directly');
assert.ok(!/impl\.normalizePagocardsWebhook\s*\(/.test(libTs), 'TS does not call impl.normalizePagocardsWebhook');
assert.ok(!/\bexport\s+function\b/.test(libTs), 'TS helper has no ESM export function');
assert.ok(service.includes('pagocardsWebhook.cjs'), 'service prefers .cjs');
assert.ok(service.includes('updateFromPago'), 'service updates card status');
assert.ok(service.includes('cardUpdated'), 'service reports card update');
assert.ok(webhookRoute.includes('cardUpdated'), 'Express ACK reports card update');
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
assert.strictEqual(event.localStatus, null);
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
assert.strictEqual(nested.localStatus, null);

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

const frozen = normalizePagocardsWebhook({
  eventId: 'st-frozen',
  eventType: 'card.status',
  cardId: 'card_status_1',
  status: 'frozen',
});
assert.ok(frozen);
assert.strictEqual(frozen.localStatus, 'frozen');
assert.strictEqual(frozen.cardStatus, 'frozen');
assert.strictEqual(frozen.is3ds, false);

const terminated = normalizePagocardsWebhook({
  type: 'card.terminated',
  cardid: 'card_term',
});
assert.ok(terminated);
assert.strictEqual(terminated.localStatus, 'terminated');
assert.strictEqual(terminated.eventId, 'card-status-card_term-terminated');

const active = normalizePagocardsWebhook({
  card_id: 'card_act',
  card_status: 'unfrozen',
});
assert.ok(active);
assert.strictEqual(active.localStatus, 'active');
assert.strictEqual(active.eventId, 'card-status-card_act-active');

assert.strictEqual(direct.mapWebhookCardStatus('blocked', 'card.updated'), 'frozen');
assert.strictEqual(direct.mapWebhookCardStatus('cancelled', ''), 'terminated');
assert.strictEqual(direct.mapWebhookCardStatus('activated', ''), 'active');
assert.strictEqual(direct.mapWebhookCardStatus('weird', 'card.updated'), null);
assert.strictEqual(direct.mapWebhookCardStatus('frozen', '3ds'), null);

const unknownStatus = normalizePagocardsWebhook({
  eventId: 'st-unk',
  cardId: 'card_unk',
  status: 'weird',
});
assert.ok(unknownStatus);
assert.strictEqual(unknownStatus.localStatus, null);
assert.strictEqual(normalizePagocardsWebhook({ cardId: 'card_drop', status: 'weird' }), null);

const { execFileSync } = require('child_process');
execFileSync(process.execPath, ['--experimental-strip-types', '-e', `
  const lib = require(${JSON.stringify(path.join(root, 'lib/pagocardsWebhook.ts'))});
  if (typeof lib.normalizePagocardsWebhook !== 'function') {
    throw new Error('ts export missing normalizePagocardsWebhook');
  }
  const event = lib.normalizePagocardsWebhook({
    eventType: 'card.frozen',
    cardId: 'c1',
    status: 'frozen',
  });
  if (!event || event.localStatus !== 'frozen') {
    throw new Error('ts normalize failed ' + JSON.stringify(event));
  }
`], { stdio: 'inherit' });

async function assertStatusPersists() {
  const os = require('os');
  const dbFile = path.join(os.tmpdir(), `eisy-pago-webhook-status-${process.pid}.db`);
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh */ }
  }
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.DATABASE_AUTH_TOKEN = '';
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';

  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  const { initDb, closeDb } = require('../src/db');
  const User = require('../src/models/User');
  const Card = require('../src/models/Card');
  const { handlePagocardsWebhook } = require('../src/services/pago3dsWebhookService');

  await initDb();
  resetSupabaseClientForTests();
  const stamp = Date.now();
  const user = await User.create({
    name: 'Webhook Status',
    phone: `8${String(stamp).slice(-9)}`,
    email: `pago-wh-${stamp}@example.com`,
    pinHash: null,
  });
  const pagoId = `card_wh_${stamp}`;
  const created = await Card.createFromPago({
    userId: user.id,
    pagoCardId: pagoId,
    status: 'active',
    pagoStatus: 'normal',
    lastFour: '4242',
    brand: 'visa',
  });
  assert.strictEqual(created.status, 'active');

  const frozenResult = await handlePagocardsWebhook({
    eventId: `freeze-${stamp}`,
    eventType: 'card.status',
    cardId: pagoId,
    status: 'frozen',
  });
  assert.strictEqual(frozenResult.cardUpdated, true);
  assert.strictEqual(frozenResult.event.localStatus, 'frozen');
  const frozenRow = await Card.findByProviderCardId(pagoId);
  assert.strictEqual(frozenRow.status, 'frozen');
  assert.strictEqual(frozenRow.pago_status, 'frozen');

  const again = await handlePagocardsWebhook({
    eventId: `freeze-${stamp}`,
    eventType: 'card.status',
    cardId: pagoId,
    status: 'frozen',
  });
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(again.cardUpdated, true);
  assert.strictEqual((await Card.findByProviderCardId(pagoId)).status, 'frozen');

  const otpResult = await handlePagocardsWebhook({
    eventId: `otp-${stamp}`,
    eventType: '3ds',
    cardid: pagoId,
    otp: '234562',
    status: 'active',
  });
  assert.strictEqual(otpResult.event.localStatus, null);
  assert.strictEqual(otpResult.cardUpdated, false);
  assert.strictEqual(otpResult.event.otp, '234562');
  assert.strictEqual((await Card.findByProviderCardId(pagoId)).status, 'frozen');

  const bankcardId = `bank_${stamp}`;
  await Card.createFromPago({
    userId: user.id,
    pagoCardId: bankcardId,
    status: 'active',
    pagoStatus: 'normal',
    lastFour: '1111',
  });
  const byBank = await handlePagocardsWebhook({
    eventId: `term-${stamp}`,
    eventType: 'card.cancelled',
    userBankcardId: bankcardId,
  });
  assert.strictEqual(byBank.cardUpdated, true);
  assert.strictEqual((await Card.findByProviderCardId(bankcardId)).status, 'terminated');

  await closeDb();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* cleaned */ }
  }
}

assertStatusPersists()
  .then(() => {
    console.log('pagocards 3ds webhook checks passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
