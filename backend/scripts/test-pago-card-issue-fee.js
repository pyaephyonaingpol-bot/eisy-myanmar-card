#!/usr/bin/env node
'use strict';

/**
 * Card request form shows the issuing fee and refuses a short wallet.
 * Run: node backend/scripts/test-pago-card-issue-fee.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dbFile = path.join('/tmp', 'eisy-pago-issue-fee.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh file */ }
}

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.TURSO_DATABASE_URL = '';
process.env.TURSO_AUTH_TOKEN = '';
process.env.DATABASE_AUTH_TOKEN = '';
process.env.SUPABASE_URL = 'off';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';

const root = path.join(__dirname, '../..');
const { quoteCardIssuanceCheckout } = require('../src/constants/cardIssuanceFees');

const quoted = quoteCardIssuanceCheckout({
  initialLoadUsd: 20,
  settings: {
    card_issuance_fee_usd: 7.25,
    card_processing_fee_usd: 1.5,
    card_funding_fee_percent: 10,
  },
});
assert.strictEqual(quoted.card_issuance_fee_usd, 7.25);
assert.strictEqual(quoted.card_processing_fee_usd, 1.5);
assert.strictEqual(quoted.funding_fee_usd, 2);
assert.strictEqual(quoted.initial_load_usd, 20);
assert.strictEqual(quoted.total_usd, 30.75);

const zeroIssuance = quoteCardIssuanceCheckout({
  initialLoadUsd: 0,
  settings: { card_issuance_fee_usd: 0, card_processing_fee_usd: 1.5, card_funding_fee_percent: 0 },
});
assert.strictEqual(zeroIssuance.card_issuance_fee_usd, 0);
assert.strictEqual(zeroIssuance.total_usd, 1.5);

const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pagoIssueSummary"'), 'price summary is on the request form');
  assert.ok(doc.includes('id="pagoIssueFee"'), 'issuing fee amount is shown');
  assert.ok(doc.includes('Price summary'), 'summary heading');
  assert.ok(doc.includes('id="pagoIssueBalanceWarning"'), 'insufficient balance warning');
  assert.ok(doc.includes('Insufficient balance'), 'warning copy');
  assert.ok(doc.indexOf('id="pagoIssueSummary"') < doc.indexOf('id="pagoCardRequestSubmit"'), 'summary sits above the submit button');
}

assert.ok(dash.includes('updatePagoIssueSummary'), 'client refreshes the price summary');
assert.ok(dash.includes("btn.disabled = short"), 'short wallet disables Request card');
assert.ok(dash.includes("if (preview?.short) return"), 'submit stops when the wallet is short');
assert.ok(dash.includes("'/api/user/cards/issue-pricing'"), 'client loads the admin issuing fee');
assert.ok(dash.includes("pago_issue_insufficient', 'Insufficient balance'"), 'warning uses the insufficient balance label');
assert.ok(i18n.includes("pago_issue_insufficient: 'Insufficient balance'"), 'EN warning');
assert.ok(i18n.includes("pago_issue_fee: 'Card issuing fee'"), 'EN fee label');
assert.ok(i18n.includes("pago_issue_insufficient: 'လက်ကျန် မလုံလောက်ပါ'"), 'MY warning');

const issueRoute = routes.slice(
  routes.indexOf("router.get('/cards/issue-pricing'"),
  routes.indexOf("router.get('/cards/topup-pricing'")
);
assert.ok(issueRoute.includes('card_issuance_fee_usd'), 'issue pricing returns the admin fee');
assert.ok(
  routes.indexOf("router.get('/cards/issue-pricing'") < routes.indexOf("router.get('/cards/:id'"),
  'issue pricing is registered before the card id route'
);

const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const { setSetting } = require('../src/services/settingsService');
const { issuePagoCardForUser } = require('../src/services/pagoCardService');

function sampleCard(overrides = {}) {
  return {
    card_id: 'card_fee_1',
    product_code: 'us_404_visa_bin',
    brand: 'visa',
    type: 'virtual',
    currency: 'USD',
    status: 'active',
    name_on_card: 'Fee User',
    email: 'issue-fee@example.com',
    last_four: '4040',
    expiry_month: '11',
    expiry_year: '30',
    balance: { amount: 0, display_amount: 0, currency: 'USD' },
    card_number: '4111111111114040',
    cvv: '321',
    created_at: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}

async function balanceOf(userId) {
  const row = await getDb().get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row.balance_usdt || 0);
}

async function run() {
  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();
  resetSupabaseClientForTests();

  const stamp = Date.now();
  const shortUser = await User.create({
    name: 'Short Wallet',
    phone: `8${String(stamp).slice(-9)}`,
    email: `issue-short-${stamp}@example.com`,
    pinHash: null,
  });
  await getDb().run('UPDATE users SET balance_usdt = 4 WHERE id = ?', shortUser.id);

  let calls = 0;
  const client = {
    async createVirtualCard() {
      calls += 1;
      return sampleCard();
    },
    async getCardDetails() {
      return sampleCard();
    },
  };

  await assert.rejects(
    () => issuePagoCardForUser({
      userId: shortUser.id,
      productCode: 'us_404_visa_bin',
      firstName: 'Short',
      lastName: 'Wallet',
      email: shortUser.email,
    }, { client }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE' && err.message === 'Insufficient balance'
  );
  assert.strictEqual(calls, 0, 'short wallet never calls Pago');
  assert.strictEqual(await balanceOf(shortUser.id), 4);

  await setSetting('card_issuance_fee_usd', '7.25');
  await setSetting('card_funding_fee_percent', '10');
  const funded = await User.create({
    name: 'Funded Wallet',
    phone: `7${String(stamp).slice(-9)}`,
    email: `issue-funded-${stamp}@example.com`,
    pinHash: null,
  });
  await getDb().run('UPDATE users SET balance_usdt = 200 WHERE id = ?', funded.id);
  const issued = await issuePagoCardForUser({
    userId: funded.id,
    productCode: 'us_404_visa_bin',
    firstName: 'Funded',
    lastName: 'Wallet',
    email: funded.email,
    initialLoad: 20,
  }, { client });
  assert.strictEqual(calls, 1);
  assert.strictEqual(issued.pricing.card_issuance_fee_usd, 7.25);
  assert.strictEqual(issued.pricing.funding_fee_usd, 2);
  assert.strictEqual(issued.debited_usdt, 30.75);
  assert.strictEqual(await balanceOf(funded.id), 169.25);

  console.log('pago card issuing fee checks passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await closeDb(); } catch (_) { /* ignore */ }
  });
