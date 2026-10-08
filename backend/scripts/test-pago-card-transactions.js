#!/usr/bin/env node
'use strict';

/**
 * Per-card Pago transaction history: normalizer, service, and card detail UI.
 * Run: node backend/scripts/test-pago-card-transactions.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pagoTxPanel"'), 'transaction panel on card detail');
  assert.ok(doc.includes('id="pagoTxList"'), 'transaction list present');
  assert.ok(doc.includes('id="pagoTxRefreshBtn"'), 'transaction refresh button');
  assert.ok(doc.includes('data-i18n="pago_tx_heading"'), 'heading i18n key');
  assert.ok(doc.includes('data-i18n="pago_tx_merchant"'), 'merchant column');
  assert.ok(doc.includes('data-i18n="pago_tx_date"'), 'date column');
  assert.ok(doc.includes('data-i18n="pago_tx_amount"'), 'amount column');
  assert.ok(doc.includes('data-i18n="pago_tx_status"'), 'status column');
  const panelAt = doc.indexOf('id="pagoTxPanel"');
  const detailAt = doc.indexOf('id="pagoCardDetailPanel"');
  const topupAt = doc.indexOf('id="pagoCardTopupForm"');
  assert.ok(detailAt > -1 && panelAt > detailAt && topupAt > panelAt, 'history sits inside the card detail');
}

assert.ok(css.includes('.pago-tx-item'), 'transaction row styles');
assert.ok(css.includes('.pago-tx-status.is-completed'), 'completed status style');
assert.ok(css.includes('.pago-tx-status.is-declined'), 'declined status style');
assert.ok(css.includes('.pago-tx-amount'), 'amount styles');

assert.ok(dash.includes('loadPagoCardTransactions'), 'dashboard loads card transactions');
assert.ok(dash.includes('/api/user/cards/${cardId}/transactions'), 'dashboard calls per-card route');
assert.ok(dash.includes('renderPagoCardTransactions'), 'dashboard renders the list');
assert.ok(dash.includes('pago-tx-merchant'), 'merchant cell');
assert.ok(dash.includes('pago-tx-date'), 'date cell');
assert.ok(dash.includes('pago-tx-amount'), 'amount cell');
assert.ok(dash.includes('pago-tx-status'), 'status cell');
assert.ok(dash.includes('pagoTxRefreshBtn'), 'refresh button bound');

assert.ok(i18n.includes("pago_tx_heading: 'Transaction history'"), 'EN heading');
assert.ok(i18n.includes("pago_tx_heading: 'အသုံးစရိတ် မှတ်တမ်း'"), 'MY heading');
assert.ok(i18n.includes("pago_tx_status_completed: 'Completed'"), 'EN completed');
assert.ok(i18n.includes("pago_tx_status_completed: 'ပြီးစီး'"), 'MY completed');
assert.ok(i18n.includes("pago_tx_empty: 'No transactions for this card yet.'"), 'EN empty');

assert.ok(routes.includes("router.get('/cards/:id/transactions'"), 'transactions route registered');
assert.ok(routes.includes('listPagoCardTransactions'), 'route uses the service');
const idxTx = routes.indexOf("router.get('/cards/:id/transactions'");
const idxId = routes.indexOf("router.get('/cards/:id'");
assert.ok(idxTx > idxId, 'transactions route is more specific than card detail');

assert.ok(client.includes('/transactions?pageNum='), 'Pago client uses documented transactions path');

const { normalizePagoCardTransactions } = require('../src/services/pagoCardService');

const sample = normalizePagoCardTransactions({
  transactions: [
    {
      id: 'tx-shop',
      merchant_name: 'MYPAL',
      display_amount: '12.50',
      transaction_currency: 'USD',
      status: 'success',
      created_at: '2026-10-08T04:12:00Z',
    },
    {
      id: 'tx-otp',
      otp: '234562',
      merchant_mcc: '4121',
    },
    {
      transaction_id: 'tx-minor',
      merchant: { name: 'Cafe' },
      amount: { amount: 2500000, currency: 'USD' },
      status: 'pending',
      created_at: 1760000000,
    },
    {
      id: 'tx-refund',
      description: 'Refund Shop',
      transaction_amount: '4.20',
      currency: 'USD',
      type: 'refund',
      date: '2026-10-07T09:00:00Z',
    },
    {
      id: 'tx-decline',
      merchant_name: 'Declined Mart',
      amount: 8.1,
      status: 'declined',
      transaction_time: '2026-10-06T15:04:00Z',
    },
  ],
});

assert.strictEqual(sample.length, 4, 'otp-only row is omitted');
assert.strictEqual(sample[0].id, 'tx-shop');
assert.strictEqual(sample[0].merchant, 'MYPAL');
assert.strictEqual(sample[0].amount, 12.5);
assert.strictEqual(sample[0].currency, 'USD');
assert.strictEqual(sample[0].status, 'completed');
assert.strictEqual(sample[0].date, '2026-10-08T04:12:00.000Z');

assert.strictEqual(sample[1].merchant, 'Cafe');
assert.strictEqual(sample[1].amount, 2.5);
assert.strictEqual(sample[1].status, 'pending');
assert.ok(sample[1].date.startsWith('2025-') || sample[1].date.endsWith('Z'));

assert.strictEqual(sample[2].merchant, 'Refund Shop');
assert.strictEqual(sample[2].amount, -4.2);
assert.strictEqual(sample[2].status, 'refunded');

assert.strictEqual(sample[3].merchant, 'Declined Mart');
assert.strictEqual(sample[3].amount, 8.1);
assert.strictEqual(sample[3].status, 'declined');

const nested = normalizePagoCardTransactions({
  data: {
    transactions: [{ id: 'n1', merchant_name: 'Nested', transaction_amount: 3, status: 'posted' }],
  },
});
assert.strictEqual(nested.length, 1);
assert.strictEqual(nested[0].amount, 3);
assert.strictEqual(nested[0].status, 'completed');

assert.deepStrictEqual(normalizePagoCardTransactions(null), []);
assert.deepStrictEqual(normalizePagoCardTransactions({ foo: 1 }), []);

async function assertServiceFetchesOneCard() {
  const dbFile = path.join(os.tmpdir(), `eisy-pago-tx-${process.pid}.db`);
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
  const { listPagoCardTransactions } = require('../src/services/pagoCardService');

  await initDb();
  resetSupabaseClientForTests();
  const stamp = Date.now();
  const owner = await User.create({
    name: 'Tx Owner',
    phone: `7${String(stamp).slice(-9)}`,
    email: `pago-tx-${stamp}@example.com`,
    pinHash: null,
  });
  const other = await User.create({
    name: 'Tx Other',
    phone: `6${String(stamp).slice(-9)}`,
    email: `pago-tx-other-${stamp}@example.com`,
    pinHash: null,
  });
  const pagoId = `card_tx_${stamp}`;
  const card = await Card.createFromPago({
    userId: owner.id,
    pagoCardId: pagoId,
    status: 'active',
    pagoStatus: 'normal',
    lastFour: '4242',
    brand: 'visa',
  });
  const calls = [];
  const client = {
    async listCardTransactions(cardId, pageNum) {
      calls.push({ cardId, pageNum });
      return {
        transactions: [{
          id: 'live-1',
          merchant_name: 'Market',
          display_amount: 19.99,
          currency: 'USD',
          status: 'approved',
          created_at: '2026-10-08T01:02:03Z',
        }],
      };
    },
  };

  const listed = await listPagoCardTransactions({
    userId: owner.id,
    localCardId: card.id,
    page: 2,
  }, { client });
  assert.deepStrictEqual(calls, [{ cardId: pagoId, pageNum: 2 }]);
  assert.strictEqual(listed.transactions.length, 1);
  assert.strictEqual(listed.transactions[0].merchant, 'Market');
  assert.strictEqual(listed.transactions[0].amount, 19.99);
  assert.strictEqual(listed.transactions[0].status, 'completed');
  assert.strictEqual(listed.card_id, card.id);
  assert.strictEqual(listed.pago_card_id, pagoId);

  let denied = false;
  try {
    await listPagoCardTransactions({ userId: other.id, localCardId: card.id }, { client });
  } catch (err) {
    denied = err.code === 'CARD_NOT_FOUND' && err.status === 404;
  }
  assert.strictEqual(denied, true);

  const localOnly = await Card.createFromPago({
    userId: owner.id,
    pagoCardId: `card_local_${stamp}`,
    status: 'pending',
    lastFour: '0000',
  });
  await require('../src/db').getDb().run(
    'UPDATE cards_v2 SET pago_card_id = NULL WHERE id = ?',
    localOnly.id
  );
  const empty = await listPagoCardTransactions({
    userId: owner.id,
    localCardId: localOnly.id,
  }, { client });
  assert.deepStrictEqual(empty.transactions, []);
  assert.strictEqual(calls.length, 1, 'cards without a provider id do not call Pago');

  await closeDb();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* cleaned */ }
  }
}

assertServiceFetchesOneCard()
  .then(() => {
    console.log('pago card transaction history checks passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
