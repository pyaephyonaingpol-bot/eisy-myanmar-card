#!/usr/bin/env node
/**
 * Kripicard Hub — live-shaped catalog (platforms/subcategories) + flat $1 fee.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));
process.env.KRIPICARD_HUB_FORCE_FALLBACK = '1';
delete process.env.KRIPICARD_API_KEY;

const {
  KRIPICARD_HUB_CATEGORIES,
  KRIPICARD_HUB_PROCESSING_FEE_USD,
  calculateHubPurchaseTotals,
  getCategory,
} = require('../src/constants/kripicardServiceCategories');
const {
  normalizeSmmCatalog,
  buildFilterMeta,
  normalizeServiceProduct,
  mapMainServicesToHubCategories,
  resolveHubCategory,
  resolveCountryName,
  resolveCountryIsoFilter,
  pickDisplayName,
  enrichDisplayLabels,
  expandGiftCardProducts,
  expandProxyFamilies,
  listFromCatalogPayload,
  DEFAULT_SERVICES_PATH,
  ALL_KEY,
} = require('../../lib/kripicardHubApi');

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

section('country ids and bare numbers resolve to real names');
{
  assert.strictEqual(resolveCountryName(14), 'Hong Kong');
  assert.strictEqual(resolveCountryName('1004'), 'Kosovo');
  assert.strictEqual(resolveCountryName('US'), 'United States');
  assert.strictEqual(pickDisplayName(14, 'WhatsApp'), 'Hong Kong');
  assert.strictEqual(pickDisplayName('WhatsApp', 14), 'WhatsApp');

  const smsRow = normalizeServiceProduct({
    product_id: 'sms-1-14',
    service_name: 'WhatsApp',
    country_id: 14,
    price_usd: 0.25,
  }, { categoryId: 'sms', platform: 'WhatsApp' });
  assert.strictEqual(smsRow.platform, 'WhatsApp');
  assert.strictEqual(smsRow.subcategory, 'Hong Kong');
  assert.ok(smsRow.name.includes('Hong Kong'));
  assert.ok(!/\b14\b/.test(smsRow.subcategory));

  const enriched = enrichDisplayLabels([{
    product_id: 'sms-1-1004',
    name: 'Telegram · country 1004',
    platform: 'Telegram',
    platform_key: 'telegram',
    subcategory: '1004',
    subcategory_key: '1004',
    country_id: '1004',
    price_usd: 0.3,
  }]);
  assert.strictEqual(enriched[0].subcategory, 'Kosovo');
  assert.ok(enriched[0].name.includes('Kosovo'));
  assert.ok(!enriched[0].name.includes('1004'));

  const chips = buildFilterMeta(enriched, {});
  assert.ok(chips.subcategories.some((s) => s.name === 'Kosovo'));
  assert.ok(!chips.subcategories.some((s) => s.name === '1004'));
  console.log('ok');
}

section('main /services payload maps into Hub categories');
{
  assert.strictEqual(DEFAULT_SERVICES_PATH, '/services');
  assert.strictEqual(resolveHubCategory('smm'), 'social_media');
  assert.strictEqual(resolveHubCategory('gifts'), 'gift_cards');
  assert.strictEqual(resolveHubCategory('sim'), 'sim_topup');

  const mapped = mapMainServicesToHubCategories({
    success: true,
    data: {
      sms: [{ id: 1, name: 'WhatsApp', code: 'wa', price_usd: 0.12, platform: 'WhatsApp', category: 'US' }],
      smm: {
        services: [
          {
            service_id: 9397,
            name: 'Instagram Followers',
            platform: 'Instagram',
            category: 'Followers',
            pricing_model: 'per_1000',
            price_usd: 0.8,
            min: 50,
            max: 5000000,
            features: ['Fast'],
          },
          {
            service_id: 8150,
            name: 'Instagram Package',
            platform: 'Instagram',
            category: 'Packages',
            pricing_model: 'package',
            price_usd: 12.62,
            min: 1,
            max: 1,
          },
        ],
        platforms: [{ name: 'Instagram', count: 2 }],
      },
      esim: [{ product_id: 'esim-de-1gb', name: 'Germany 1GB / 30 days', data: '1GB', price: 8.5, country: 'DE' }],
      gifts: {
        products: [{
          product_id: 20004,
          name: 'App Store & iTunes Turkey',
          brand: 'App Store & iTunes',
          country_iso: 'TR',
          currency: 'USD',
          fixed_denominations: [25, 50, 100],
        }],
      },
      sim: [{
        operator_id: 120,
        operator_name: 'Vodafone EG',
        country: 'EG',
        packages: [{ index: 0, name: '50 EGP Bundle', amount: 50, currency: 'EGP', usd_price: 1.02 }],
      }],
      proxies: {
        enabled: true,
        families: {
          static: [{ type: 'individual_ipv4', label: 'Individual (Datacenter)', min_price_usd: 4 }],
          pool: [{ type: 'residential_ipv4', label: 'Residential (Rotating)', min_price_usd: 3.84 }],
        },
      },
    },
  });

  assert.ok(mapped.sms.length >= 1);
  assert.ok(mapped.social_media.length >= 2);
  assert.ok(mapped.esim.length >= 1);
  assert.ok(mapped.gift_cards.length >= 1, 'gift dens expand into priced products');
  assert.ok(mapped.sim_topup.length >= 1);
  assert.ok(mapped.proxies.length >= 2);
  assert.strictEqual(mapped.social_media[0].platform_key, 'instagram');
  assert.ok(['followers', 'packages'].includes(mapped.social_media[0].subcategory_key));
  console.log('ok');
}

section('module parsers: gifts dens, eSIM packages envelope, proxies plans');
{
  assert.strictEqual(resolveCountryIsoFilter('United States'), 'US');
  assert.strictEqual(resolveCountryIsoFilter('tr'), 'TR');

  const giftProducts = expandGiftCardProducts([
    {
      product_id: 20004,
      product_name: 'App Store & iTunes TRY',
      brand: 'Apple',
      country_iso: 'TR',
      country_name: 'Turkey',
      currency: 'TRY',
      denominations: [10, 25, 50],
      fixedSenderDenominations: [0.3, 0.75, 1.5],
    },
    {
      product_id: 30001,
      product_name: 'Amazon US',
      brand: 'Amazon',
      country_iso: 'US',
      currency: 'USD',
      denominations: [15, 25],
    },
  ]);
  assert.ok(giftProducts.length >= 5, `expected expanded gift SKUs, got ${giftProducts.length}`);
  assert.ok(giftProducts.every((p) => p.price_usd > 0));
  assert.ok(giftProducts.every((p) => p.processing_fee_usd == null)); // fee applied in hub service
  assert.ok(giftProducts.some((p) => p.name.includes('25 TRY') || p.name.includes('25 USD') || p.local_amount === 25));
  assert.ok(giftProducts.some((p) => (p.platform || '').includes('Turkey') || (p.platform || '').includes('United')));

  const esimRows = listFromCatalogPayload({
    success: true,
    data: {
      packages: [{
        packageCode: 'ESIM_US_5GB_30D',
        country: 'United States',
        countryCode: 'US',
        data: '5GB',
        duration: '30 days',
        price: 25,
        currency: 'USD',
      }],
      pagination: { page: 1, per_page: 20, total: 1 },
    },
  });
  assert.strictEqual(esimRows.length, 1);
  const esimProduct = normalizeServiceProduct({
    ...esimRows[0],
    product_id: esimRows[0].packageCode,
    price_usd: esimRows[0].price,
    platform: 'United States',
    category: '5GB',
  }, { categoryId: 'esim', platform: 'United States', subcategory: '5GB' });
  assert.ok(esimProduct);
  assert.strictEqual(esimProduct.price_usd, 25);
  assert.ok(esimProduct.name.includes('United States') || esimProduct.platform.includes('United'));

  const proxyProducts = expandProxyFamilies({
    packages: [
      { product_id: 'px-1', name: 'Residential 1GB', family: 'pool', price_usd: 3.5 },
      { type: 'isp_static', label: 'ISP Static', family: 'static', min_price_usd: 5 },
    ],
  });
  assert.ok(proxyProducts.length >= 2);
  assert.ok(proxyProducts.every((p) => p.price_usd > 0));
  console.log('ok');
}

section('SMM nested platforms → groups → services normalizer');
{
  const nested = normalizeSmmCatalog({
    success: true,
    data: {
      enabled: true,
      count: 3,
      platforms: [
        {
          key: 'instagram',
          name: 'Instagram',
          groups: [
            {
              name: 'Followers',
              services: [
                {
                  service: 101,
                  name: 'IG Followers Fast',
                  rate_usd: 2.5,
                  pricing_model: 'per_1000',
                  min: 100,
                  max: 10000,
                  features: ['Fast', 'Refill'],
                },
              ],
            },
            {
              name: 'Likes',
              services: [
                {
                  service: 102,
                  name: 'IG Likes',
                  rate_usd: 1.1,
                  pricing_model: 'package',
                  min: 1,
                  max: 1,
                  features: [],
                },
              ],
            },
          ],
        },
        {
          key: 'tiktok',
          name: 'TikTok',
          groups: [
            {
              name: 'Views',
              services: [
                {
                  service: 201,
                  name: 'TT Views',
                  rate_usd: 0.9,
                  pricing_model: 'per_1000',
                  min: 1000,
                  features: ['HQ'],
                },
              ],
            },
          ],
        },
      ],
    },
  }, { platform: 'instagram' });

  assert.ok(nested.platforms.some((p) => p.key === 'instagram' || p.name === 'Instagram'));
  assert.ok(nested.products.every((p) => p.platform_key === 'instagram'));
  assert.ok(nested.subcategories.some((s) => s.key === 'followers' || s.name === 'Followers'));
  nested.products.forEach((p) => {
    assert.ok(p.price_usd > 0);
    assert.ok(p.product_id);
  });

  const filtered = buildFilterMeta(nested.products, {
    platform: 'instagram',
    subcategory: 'likes',
  });
  assert.strictEqual(filtered.products.length, 1);
  assert.strictEqual(filtered.products[0].name, 'IG Likes');
  console.log('ok');
}

section('UI hub switch surfaces filters + remaining categories');
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
  assert.ok(dash.includes('hubServiceModal'), 'service catalog modal');
  assert.ok(dash.includes('ensureHubServiceModal'), 'modal factory');
  assert.ok(dash.includes('closeHubServiceModal'), 'modal close helper');
  assert.ok(dash.includes('/api/kripicard/services/purchase'), 'purchase API call');
  assert.ok(dash.includes('data-hub-platform'), 'platform filter chips');
  assert.ok(dash.includes('data-hub-subcategory'), 'subcategory filter chips');
  assert.ok(dash.includes('reloadHubServiceCatalog'), 'dynamic reload');
  assert.ok(dash.includes("category.id === 'esim'"), 'eSIM country input routing');
  assert.ok(dash.includes("category.id === 'gift_cards'"), 'gift card country input routing');
  assert.ok(dash.includes("category.id === 'sim_topup'"), 'SIM top-up number/country inputs');
  assert.ok(dash.includes('+$1.00 fee') || dash.includes('hub_processing_fee_chip'), 'fee chip');
  assert.ok(dash.includes('Open Instant →') || dash.includes('data-portal-switch="instant"'), 'Instant remains in top switch');
  assert.ok(!dash.includes("id = 'portalHubServicePanel'") && !dash.includes('id="portalHubServicePanel"'), 'inline service panel removed');
  assert.ok(i18n.includes('hub_cat_sms_title'));
  assert.ok(i18n.includes('hub_filter_platform'));
  assert.ok(i18n.includes('hub_filter_subcategory'));
  assert.ok(!i18n.includes('hub_cat_webhooks_title'), 'i18n webhooks keys removed');
  assert.ok(i18n.includes('flat $1.00 USD processing fee') || i18n.includes('$1.00 USD processing fee'));
  assert.ok(css.includes('portal-hub-fee-chip'));
  assert.ok(css.includes('hub-filter-chip'));
  assert.ok(css.includes('hub-service-modal'));
  assert.ok(css.includes('hub-service-modal-box'));
  assert.ok(css.includes('hub-service-product-list'));
  const catalog = fs.readFileSync(path.join(__dirname, '../src/constants/kripicardHubCatalog.js'), 'utf8');
  assert.ok(!/\bwebhooks\s*:/.test(catalog), 'catalog omits webhooks products');
  assert.ok(catalog.includes('platform:'), 'fallback catalog has platform fields');
  assert.ok(catalog.includes('subcategory:'), 'fallback catalog has subcategory fields');
  console.log('ok');
}

section('backend routes + live API client + fee type');
{
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/kripicardServices.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const feeTypes = fs.readFileSync(path.join(__dirname, '../src/constants/platformFeeTypes.js'), 'utf8');
  const svc = fs.readFileSync(path.join(__dirname, '../src/services/kripicardHubService.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '../../lib/kripicardHubApi.js'), 'utf8');
  assert.ok(indexJs.includes('/api/kripicard/services'));
  assert.ok(route.includes("router.post('/purchase'"));
  assert.ok(route.includes("router.get('/categories'"));
  assert.ok(route.includes("/platforms'"));
  assert.ok(route.includes('catalogForCategoryAsync'));
  assert.ok(feeTypes.includes('HUB_SERVICE'));
  assert.ok(svc.includes('fetchLiveHubCatalog'));
  assert.ok(svc.includes('calculateHubPurchaseTotals') || svc.includes('processing_fee_usd'));
  assert.ok(svc.includes('debitUsdt'));
  assert.ok(api.includes("DEFAULT_SERVICES_PATH = '/services'") || api.includes("'/services'"));
  assert.ok(api.includes('fetchMainServicesCatalog'));
  assert.ok(api.includes('mapMainServicesToHubCategories'));
  assert.ok(api.includes('fetchModuleCatalog'), 'module-first catalog client');
  assert.ok(api.includes('/smm/services'), 'SMM module route');
  assert.ok(api.includes('/sms/services'), 'SMS module route');
  assert.ok(api.includes('/esim/packages'), 'eSIM module route');
  assert.ok(api.includes('/gifts/packages'), 'gifts module route');
  assert.ok(api.includes('/sim/packages'), 'SIM module route');
  assert.ok(api.includes('/proxies/types'), 'proxies module route');
  assert.ok(
    api.includes('module routes first')
      || api.includes('Module-first')
      || api.includes('module-first'),
    'module-first documented in client'
  );
  assert.ok(api.includes('expandGiftCardProducts'));
  assert.ok(fs.existsSync(path.join(__dirname, '../migrations/067_kripicard_hub_purchases.sql')));
  console.log('ok');
}

section('async catalog + purchase always adds $1');
(async () => {
  const dbFile = path.join(os.tmpdir(), `eisy-hub-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.KRIPICARD_HUB_FORCE_FALLBACK = '1';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/services/kripicardHubService')];
  delete require.cache[require.resolve('../../lib/kripicardHubApi')];

  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    catalogForCategory,
    catalogForCategoryAsync,
    quotePurchase,
    purchaseHubProduct,
  } = require('../src/services/kripicardHubService');
  const User = require('../src/models/User');
  const { creditUsdt } = require('../src/services/walletService');

  await initDb();

  const syncCatalog = catalogForCategory('social_media', { platform: 'instagram' });
  assert.ok(syncCatalog.platforms.length >= 2);
  assert.ok(syncCatalog.subcategories.length >= 1);
  assert.ok(syncCatalog.products.every((p) => p.platform_key === 'instagram'));
  syncCatalog.products.forEach((p) => {
    assert.strictEqual(p.processing_fee_usd, 1);
    assert.strictEqual(
      p.total_charge_usd,
      Math.round((Number(p.price_usd) + 1) * 100) / 100
    );
  });

  const liveShaped = await catalogForCategoryAsync('social_media', {
    platform: 'tiktok',
    subcategory: 'followers',
  });
  assert.strictEqual(liveShaped.source, 'fallback');
  assert.ok(liveShaped.products.length >= 1);
  assert.ok(liveShaped.products.every((p) => p.processing_fee_usd === 1));

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

  // Live-shaped product retained in cache from catalog load still charges +$1
  const sm = await catalogForCategoryAsync('social_media');
  const ig = sm.products.find((p) => p.product_id === 'social-ig-boost-1k');
  assert.ok(ig);
  const boughtLiveId = await purchaseHubProduct(user.id, {
    categoryId: 'social_media',
    productId: ig.product_id,
    link: 'https://instagram.com/example',
  });
  assert.strictEqual(boughtLiveId.purchase.processing_fee_usd, 1);
  assert.strictEqual(
    boughtLiveId.purchase.total_charge_usd,
    Math.round((Number(ig.price_usd) + 1) * 100) / 100
  );

  const db = getDb();
  const row = await db.get(
    'SELECT * FROM kripicard_hub_purchases WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    user.id
  );
  assert.ok(row);
  assert.strictEqual(Number(row.processing_fee_usd), 1);

  const normalized = normalizeServiceProduct({
    service: 9,
    name: 'Sample',
    rate_usd: 3,
    platform: 'YouTube',
    group: 'Subscribers',
  });
  assert.strictEqual(normalized.platform_key, 'youtube');
  assert.strictEqual(normalized.subcategory_key, 'subscribers');
  assert.notStrictEqual(ALL_KEY, normalized.subcategory_key);

  await closeDb();
  console.log('ok');
  console.log('\nKripicard Hub live catalog shape + $1 processing fee — ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
