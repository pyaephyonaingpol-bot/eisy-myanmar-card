#!/usr/bin/env node
/**
 * Kripicard Hub categories + flat $1 processing fee.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

const {
  KRIPICARD_HUB_CATEGORIES,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
  calculateHubPurchaseTotals,
  getCategory,
} = require('../src/constants/kripicardServiceCategories');

function section(t) {
  console.log(`\n== ${t} ==`);
}

section('categories + $1 fee constant');
assert.strictEqual(KRIPICARD_HUB_PROCESSING_FEE_USD, 1);
const ids = KRIPICARD_HUB_CATEGORIES.map((c) => c.id);
assert.deepStrictEqual(ids, [
  'sms',
  'sim_topup',
  'esim',
  'gift_cards',
  'social_media',
  'proxies',
]);
assert.ok(!ids.includes('webhooks'), 'webhooks removed from hub categories');
assert.ok(getCategory('gift-cards'));
assert.ok(getCategory('sim_topup'));
assert.strictEqual(getCategory('webhooks'), null);
const totals = calculateHubPurchaseTotals(9);
assert.strictEqual(totals.product_price_usd, 9);
assert.strictEqual(totals.processing_fee_usd, 1);
assert.strictEqual(totals.total_charge_usd, 10);
assert.ok(totals.summary.includes('$1.00'));
console.log('ok');

section('UI hub switch surfaces remaining categories (no Instant card, no Webhooks)');
{
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  for (const id of ids) {
    assert.ok(dash.includes(`id: '${id}'`) || dash.includes(`'${id}'`), `dashboard has ${id}`);
  }
  assert.ok(!dash.includes("id: 'webhooks'"), 'dashboard list omits webhooks');
  assert.ok(!dash.includes('portal-hub-card-instant'), 'Instant card removed from hub grid');
  assert.ok(dash.includes('data-hub-service'), 'hub category buttons');
  assert.ok(dash.includes('portalHubServicePanel'), 'service panel');
  assert.ok(dash.includes('/api/kripicard/services/purchase'), 'purchase API call');
  assert.ok(dash.includes('+$1.00 fee') || dash.includes('hub_processing_fee_chip'), 'fee chip');
  assert.ok(dash.includes('Open Instant →') || dash.includes('data-portal-switch="instant"'), 'Instant remains in top switch');
  assert.ok(i18n.includes('hub_cat_sms_title'));
  assert.ok(i18n.includes('hub_cat_proxies_title'));
  assert.ok(!i18n.includes('hub_cat_webhooks_title'), 'i18n webhooks keys removed');
  assert.ok(i18n.includes('flat $1.00 USD processing fee') || i18n.includes('$1.00 USD processing fee'));
  assert.ok(css.includes('portal-hub-fee-chip'));
  assert.ok(css.includes('portalHubServicePanel'));
  const catalog = fs.readFileSync(path.join(__dirname, '../src/constants/kripicardHubCatalog.js'), 'utf8');
  assert.ok(!/\bwebhooks\s*:/.test(catalog), 'catalog omits webhooks products');
  console.log('ok');
}

section('backend routes + fee type');
{
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/kripicardServices.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const feeTypes = fs.readFileSync(path.join(__dirname, '../src/constants/platformFeeTypes.js'), 'utf8');
  const svc = fs.readFileSync(path.join(__dirname, '../src/services/kripicardHubService.js'), 'utf8');
  assert.ok(indexJs.includes("/api/kripicard/services"));
  assert.ok(route.includes("router.post('/purchase'"));
  assert.ok(route.includes("router.get('/categories'"));
  assert.ok(feeTypes.includes('HUB_SERVICE'));
  assert.ok(svc.includes('calculateHubPurchaseTotals') || svc.includes('processing_fee_usd'));
  assert.ok(svc.includes('debitUsdt'));
  assert.ok(fs.existsSync(path.join(__dirname, '../migrations/067_kripicard_hub_purchases.sql')));
  console.log('ok');
}

section('purchase quote always adds $1');
(async () => {
  const dbFile = path.join(os.tmpdir(), `eisy-hub-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/services/kripicardHubService')];

  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    catalogForCategory,
    quotePurchase,
    purchaseHubProduct,
  } = require('../src/services/kripicardHubService');
  const User = require('../src/models/User');
  const { creditUsdt } = require('../src/services/walletService');

  await initDb();
  const catalog = catalogForCategory('esim');
  assert.ok(catalog.products.length >= 1);
  catalog.products.forEach((p) => {
    assert.strictEqual(p.processing_fee_usd, 1);
    assert.strictEqual(
      p.total_charge_usd,
      Math.round((Number(p.price_usd) + 1) * 100) / 100
    );
  });

  const quote = quotePurchase({ categoryId: 'gift_cards', productId: 'gift-itunes-10' });
  assert.strictEqual(quote.product_price_usd, 10);
  assert.strictEqual(quote.processing_fee_usd, 1);
  assert.strictEqual(quote.total_charge_usd, 11);

  const user = await User.create({
    name: 'Hub Tester',
    phone: `09${String(Date.now()).slice(-9)}`,
    email: `hub-${Date.now()}@example.com`,
    pinHash: 'testhash',
  });
  await creditUsdt(user.id, 50, {
    description: 'test credit',
    metadata: { purpose: 'test' },
  });

  const bought = await purchaseHubProduct(user.id, {
    categoryId: 'sms',
    productId: 'sms-us-10min',
    recipientEmail: 'buyer@example.com',
  });
  assert.strictEqual(bought.purchase.status, 'completed');
  assert.strictEqual(bought.purchase.processing_fee_usd, 1);
  assert.strictEqual(
    bought.purchase.total_charge_usd,
    Math.round((bought.purchase.product_price_usd + 1) * 100) / 100
  );

  const db = getDb();
  const row = await db.get(
    'SELECT * FROM kripicard_hub_purchases WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    user.id
  );
  assert.ok(row);
  assert.strictEqual(Number(row.processing_fee_usd), 1);

  await closeDb();
  console.log('ok');
  console.log('\nKripicard Hub categories + $1 processing fee — ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
