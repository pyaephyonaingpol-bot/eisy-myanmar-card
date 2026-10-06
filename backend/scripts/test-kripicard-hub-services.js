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
  extractSmmPage,
  mergeSmmNestedPlatforms,
  mergeNamedSmmPlatforms,
  applySmmPlatformDirectory,
  inferSmmPlatformLabel,
  combineSmmPages,
  countNestedSmmServices,
  directoryServiceTarget,
  smmPlatformsNeedingRefetch,
  smmPageLimit,
  SMM_PAGE_SIZE,
  SMM_MAX_PAGES,
  SMM_EXPECTED_TOTAL,
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

section('SMM full catalog merges every paginated page (no truncation)');
{
  assert.ok(SMM_PAGE_SIZE >= 50, 'Hub requests a large SMM page size');

  const page1 = extractSmmPage({
    success: true,
    data: {
      services: [
        { service_id: 1, name: 'IG Followers A', platform: 'Instagram', category: 'Followers', rate_usd: 1.1 },
        { service_id: 2, name: 'IG Likes A', platform: 'Instagram', category: 'Likes', rate_usd: 0.5 },
      ],
      platforms: [{ name: 'Instagram', count: 100 }, { name: 'TikTok', count: 80 }],
      pagination: { page: 1, per_page: 2, total: 5, total_pages: 3 },
    },
  });
  assert.strictEqual(page1.services.length, 2);
  assert.strictEqual(page1.total, 5);
  assert.strictEqual(page1.totalPages, 3);

  const page2 = extractSmmPage({
    success: true,
    data: {
      services: [
        { service_id: 3, name: 'TT Views', platform: 'TikTok', category: 'Views', rate_usd: 0.2 },
        { service_id: 4, name: 'IG Followers B', platform: 'Instagram', category: 'Followers', rate_usd: 2.2 },
      ],
      pagination: { page: 2, per_page: 2, total: 5, total_pages: 3 },
    },
  });
  const page3 = extractSmmPage({
    success: true,
    data: {
      services: [
        { service_id: 5, name: 'YT Subs', platform: 'YouTube', category: 'Subscribers', rate_usd: 3.3 },
        // Duplicate id from page 1 should be ignored when combining.
        { service_id: 1, name: 'IG Followers A dup', platform: 'Instagram', category: 'Followers', rate_usd: 1.1 },
      ],
      pagination: { page: 3, per_page: 2, total: 5, total_pages: 3 },
    },
  });

  const combined = combineSmmPages([page1, page2, page3], {
    reportedTotal: 5,
    namedPlatforms: page1.namedPlatforms,
  });
  assert.strictEqual(combined.data.services.length, 5, 'all unique services across pages');
  const full = normalizeSmmCatalog(combined, {});
  assert.strictEqual(full.products.length, 5);
  assert.strictEqual(full.count, 5);
  assert.ok(full.platforms.some((p) => p.name === 'Instagram'));
  assert.ok(full.platforms.some((p) => p.name === 'TikTok'));
  assert.ok(full.platforms.some((p) => p.name === 'YouTube' || p.key === 'youtube'));

  const nestedA = [{
    key: 'instagram',
    name: 'Instagram',
    groups: [{
      name: 'Followers',
      services: [{ service: 10, name: 'A', rate_usd: 1 }],
    }],
  }];
  const nestedB = [{
    key: 'instagram',
    name: 'Instagram',
    groups: [
      {
        name: 'Followers',
        services: [
          { service: 10, name: 'A', rate_usd: 1 },
          { service: 11, name: 'B', rate_usd: 2 },
        ],
      },
      {
        name: 'Likes',
        services: [{ service: 12, name: 'C', rate_usd: 3 }],
      },
    ],
  }, {
    key: 'tiktok',
    name: 'TikTok',
    groups: [{ name: 'Views', services: [{ service: 20, name: 'D', rate_usd: 4 }] }],
  }];
  const mergedNested = mergeSmmNestedPlatforms(nestedA, nestedB);
  assert.strictEqual(countNestedSmmServices(mergedNested), 4);
  assert.strictEqual(mergedNested.length, 2);

  const api = fs.readFileSync(path.join(__dirname, '../../lib/kripicardHubApi.js'), 'utf8');
  assert.ok(api.includes('fetchCompleteSmmCatalog'), 'complete SMM fetcher present');
  assert.ok(api.includes('return fetchCompleteSmmCatalog(filters)'), 'social_media uses full catalog fetch');
  assert.ok(api.includes('SMM_MAX_PAGES'), 'page walk has a safety ceiling');
  assert.ok(api.includes('per_page: pageSize'), 'requests large per_page');
  assert.ok(api.includes('paginateSmmServices'), 'per-platform SMM pagination helper');
  assert.ok(api.includes('applySmmPlatformDirectory'), 'platform directory chips helper');
  assert.ok(api.includes('directory.length > 1'), 'fetches every platform from API directory');
  assert.ok(api.includes('mapPool'), 'bounded concurrency batch helper');
  assert.ok(api.includes('SMM_CONCURRENCY'), 'SMM concurrency knob');
  assert.ok(api.includes('smmCatalogCache') || api.includes('SMM_CACHE_TTL_MS'), 'SMM eager cache');
  assert.ok(api.includes('withSingleFlight'), 'single-flight coalescing');
  assert.ok(api.includes('smmPlatformsNeedingRefetch'), 'incomplete nested platforms are re-fetched');
  assert.ok(
    api.includes('target != null && collectedCount() >= target')
      || api.includes('target != null && collected >= target'),
    'nested-only pages do not stop without an authoritative total'
  );
  assert.ok(!api.includes('Math.min(services.length, 12)'), 'SMS details are not capped at 12 services');
  assert.ok(api.includes('SMS_DETAIL_CONCURRENCY'), 'SMS detail expansion uses bounded concurrency');
  assert.ok(api.includes('ensureCompleteSmmCatalog'), 'gap-fill walk when haul is incomplete');
  assert.ok(api.includes('smmPageLimit'), 'dynamic page ceiling helper');
  assert.ok(api.includes('offset:'), 'sends offset for gateways that ignore page');
  assert.ok(SMM_MAX_PAGES >= 500, 'page ceiling covers ~5249 services at small page sizes');
  assert.ok(SMM_EXPECTED_TOTAL >= 5249, 'expected live catalog size is documented');

  // Simulate Kripicard returning 20 rows/page across 5249 services (263 pages).
  // The old 200-page soft cap would have truncated ~1260 services.
  const perPage = 20;
  const total = 5249;
  const totalPages = Math.ceil(total / perPage);
  assert.ok(totalPages > 200, 'fixture needs more than the legacy 200-page cap');
  const pageCap = smmPageLimit({
    reportedTotal: total,
    observedPageSize: perPage,
    knownTotalPages: totalPages,
  });
  assert.ok(pageCap >= totalPages, `page ceiling (${pageCap}) must cover ${totalPages} API pages`);

  const manyPages = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const start = (page - 1) * perPage;
    const end = Math.min(total, start + perPage);
    const services = [];
    for (let id = start + 1; id <= end; id += 1) {
      services.push({
        service_id: id,
        name: `Svc ${id}`,
        platform: id % 2 ? 'Instagram' : 'TikTok',
        category: 'Followers',
        rate: `$${(0.1 + (id % 50) / 100).toFixed(2)}`,
        max: 100000,
        refill: true,
      });
    }
    manyPages.push(extractSmmPage({
      success: true,
      data: {
        services,
        pagination: { page, per_page: perPage, total, total_pages: totalPages },
      },
    }));
  }
  const mega = combineSmmPages(manyPages, { reportedTotal: total });
  assert.strictEqual(mega.data.services.length, total, 'all 5249 unique services across pages');
  const megaNorm = normalizeSmmCatalog(mega, {});
  assert.strictEqual(megaNorm.products.length, total, 'normalizer keeps every priced SMM row');
  assert.ok(megaNorm.products.every((p) => p.price_usd > 0), 'string $rates parse to money');
  console.log('ok');
}

section('SMM variations: rate/refill/max options + incomplete nested refetch');
{
  const withOpts = normalizeServiceProduct({
    service: 501,
    name: 'IG Followers Max 100K',
    platform: 'Instagram',
    category: 'Followers',
    rate: 1.25,
    min: 50,
    max: 100000,
    refill: true,
    cancel: true,
  }, { categoryId: 'social_media' });
  assert.ok(withOpts, 'rate field normalizes without rate_usd');
  assert.strictEqual(withOpts.pricing_model, 'per_1000');
  assert.strictEqual(withOpts.price_usd, 1.25);
  assert.strictEqual(withOpts.max_quantity, 100000);
  assert.strictEqual(withOpts.refill, true);
  assert.ok(withOpts.options.includes('Max 100,000') || withOpts.options.some((o) => /Max/.test(o)));
  assert.ok(withOpts.options.includes('Refill'));
  assert.ok(withOpts.options.includes('Cancel'));
  assert.ok(withOpts.options.includes('Per 1K'));
  assert.ok(/Max/.test(withOpts.description) || /Refill/.test(withOpts.description));

  const directory = [
    { name: 'Instagram', count: 40 },
    { name: 'TikTok', count: 25 },
    { name: 'Facebook', count: 18 },
  ];
  assert.strictEqual(directoryServiceTarget(directory), 83);
  assert.strictEqual(directoryServiceTarget(directory, 'Instagram'), 40);

  const sparseNested = [
    {
      key: 'instagram',
      name: 'Instagram',
      groups: [{ name: 'Followers', services: [{ service: 1, name: 'A', rate_usd: 1 }] }],
    },
    {
      key: 'tiktok',
      name: 'TikTok',
      groups: [{ name: 'Views', services: [{ service: 2, name: 'B', rate_usd: 1 }] }],
    },
    {
      key: 'facebook',
      name: 'Facebook',
      groups: [{ name: 'Likes', services: [{ service: 3, name: 'C', rate_usd: 1 }] }],
    },
  ];
  const incomplete = smmPlatformsNeedingRefetch(directory, sparseNested, {
    hasAuthoritativeCounts: true,
  });
  assert.ok(incomplete.includes('Instagram'), 'Instagram incomplete vs directory count');
  assert.ok(incomplete.includes('TikTok'), 'TikTok incomplete vs directory count');
  assert.ok(incomplete.includes('Facebook'), 'Facebook incomplete vs directory count');

  const noCounts = smmPlatformsNeedingRefetch(
    sparseNested.map((p) => ({ name: p.name, key: p.key, count: 1 })),
    sparseNested,
    { hasAuthoritativeCounts: false }
  );
  assert.ok(noCounts.length >= 3, 'without authoritative counts every platform is re-fetched');

  const completeNested = [{
    key: 'instagram',
    name: 'Instagram',
    groups: [{
      name: 'Followers',
      services: Array.from({ length: 40 }, (_, i) => ({
        service: 1000 + i,
        name: `IG ${i}`,
        rate_usd: 1,
      })),
    }],
  }];
  const done = smmPlatformsNeedingRefetch(
    [{ name: 'Instagram', count: 40 }],
    completeNested,
    { hasAuthoritativeCounts: true }
  );
  assert.deepStrictEqual(done, [], 'complete nested tree needs no refetch');

  const svc = fs.readFileSync(path.join(__dirname, '../src/services/kripicardHubService.js'), 'utf8');
  assert.ok(svc.includes("catalog.source !== 'fallback'") || svc.includes("source === 'live'"), 'eager cache skips truncated fallback catalogs');
  assert.ok(svc.includes('writeSmmDiskCache'), 'persists full SMM catalog to disk');
  assert.ok(svc.includes('readSmmDiskCache'), 'reads durable SMM catalog cache');
  assert.ok(svc.includes('getSmmSyncStatus'), 'exposes SMM sync status');

  const route = fs.readFileSync(path.join(__dirname, '../src/routes/kripicardServices.js'), 'utf8');
  assert.ok(route.includes("/social_media/sync"), 'SMM sync status/refresh endpoint');
  assert.ok(route.includes('probeKripicardApiAuth') || route.includes('diagnose'), 'sync can surface auth diagnosis');

  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('hub-service-options'), 'UI renders Max/Refill option chips');
  assert.ok(dash.includes('p.options') || dash.includes('optionBits'), 'UI reads product options');
  assert.ok(dash.includes('expected_total') || dash.includes('expectedTotal'), 'UI surfaces expected catalog size');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.ok(css.includes('.hub-service-option'), 'option chip styles present');
  console.log('ok');
}

section('Eager / batch Hub catalog optimizations (static)');
{
  const api = fs.readFileSync(path.join(__dirname, '../../lib/kripicardHubApi.js'), 'utf8');
  assert.ok(api.includes('mapPool'), 'bounded concurrency batch helper');
  assert.ok(api.includes('SMM_CONCURRENCY'), 'SMM concurrency knob');
  assert.ok(api.includes('SMM_CACHE_TTL_MS'), 'SMM eager cache TTL');
  assert.ok(api.includes('withSingleFlight'), 'single-flight coalescing');
  assert.ok(api.includes('MODULE_CACHE_TTL_MS'), 'module catalog cache');

  const svc = fs.readFileSync(path.join(__dirname, '../src/services/kripicardHubService.js'), 'utf8');
  assert.ok(svc.includes('preloadAllCategoryCatalogs'), 'batch category preload');
  assert.ok(svc.includes('applyLocalCatalogFilters'), 'in-process platform/search filter');
  assert.ok(svc.includes('CATALOG_CACHE_TTL_MS'), 'eager category catalog cache');
  assert.ok(svc.includes('crypto.randomBytes(6)'), 'purchase ref avoids SELECT loop');
  assert.ok(svc.includes('SELECT id, ref_code, category_id'), 'purchases list projects columns');

  const route = fs.readFileSync(path.join(__dirname, '../src/routes/kripicardServices.js'), 'utf8');
  assert.ok(route.includes("'/preload'"), 'preload endpoint');
  assert.ok(route.includes('preloadAllCategoryCatalogs'), 'categories warm uses batch preload');

  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('filterHubCatalogLocally'), 'client-side eager filter');
  assert.ok(dash.includes('_hubFullCatalog'), 'modal keeps full catalog');
  assert.ok(dash.includes('eager'), 'eager query mode omits chip filters');
  console.log('ok');
}

section('SMM platform directory keeps Facebook/Telegram chips + name inference');
{
  assert.strictEqual(inferSmmPlatformLabel('Facebook Page Likes HQ'), 'Facebook');
  assert.strictEqual(inferSmmPlatformLabel('Telegram Channel Members'), 'Telegram');
  assert.strictEqual(inferSmmPlatformLabel('Discord Server Members'), 'Discord');

  const inferred = normalizeServiceProduct({
    service_id: 77,
    name: 'Facebook Page Likes',
    category: 'Likes',
    rate_usd: 1.25,
  }, { categoryId: 'social_media' });
  assert.ok(inferred);
  assert.strictEqual(inferred.platform_key, 'facebook');
  assert.strictEqual(inferred.subcategory_key, 'likes');

  const directory = mergeNamedSmmPlatforms([], [
    { name: 'Instagram', count: 100 },
    { name: 'Facebook', count: 80 },
    { name: 'Telegram', count: 40 },
    { name: 'TikTok', count: 60 },
    { name: 'YouTube', count: 50 },
  ]);
  assert.strictEqual(directory.length, 5);

  // Page-1 products only cover Instagram/TikTok/YouTube — directory must still expose Facebook/Telegram.
  const partial = normalizeSmmCatalog({
    success: true,
    data: {
      services: [
        { service_id: 1, name: 'IG Followers', platform: 'Instagram', category: 'Followers', rate_usd: 1 },
        { service_id: 2, name: 'TT Views', platform: 'TikTok', category: 'Views', rate_usd: 0.2 },
        { service_id: 3, name: 'YT Subs', platform: 'YouTube', category: 'Subscribers', rate_usd: 3 },
      ],
      platforms: directory,
    },
  }, {});
  assert.ok(partial.platforms.some((p) => p.key === 'facebook'), 'Facebook chip from directory');
  assert.ok(partial.platforms.some((p) => p.key === 'telegram'), 'Telegram chip from directory');
  assert.ok(partial.platforms.some((p) => p.key === 'instagram'));

  const chips = applySmmPlatformDirectory(
    [{ key: '__all__', name: 'All platforms', count: 3 }, { key: 'instagram', name: 'Instagram', count: 1 }],
    directory,
    partial.products
  );
  assert.ok(chips.some((p) => p.key === 'facebook' && p.count === 80));
  assert.ok(chips.some((p) => p.key === 'telegram' && p.count === 40));

  // Discord inferred from name when platform omitted.
  const discordProd = normalizeServiceProduct({
    service_id: 14,
    name: 'Discord Members',
    category: 'Members',
    rate_usd: 2,
  }, { categoryId: 'social_media' });
  assert.strictEqual(discordProd.platform_key, 'discord');

  const catalog = fs.readFileSync(path.join(__dirname, '../src/constants/kripicardHubCatalog.js'), 'utf8');
  assert.ok(catalog.includes("platform: 'Facebook'"), 'fallback includes Facebook');
  assert.ok(catalog.includes("platform: 'Telegram'"), 'fallback includes Telegram');
  assert.ok(catalog.includes("platform: 'Discord'"), 'fallback includes Discord');
  assert.ok(catalog.includes("platform: 'LinkedIn'"), 'fallback includes LinkedIn');
  assert.ok(catalog.includes("platform: 'Spotify'"), 'fallback includes Spotify');

  const dashUi = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(dashUi.includes('hubPlatformSelect'), 'platform filter is a select dropdown');
  assert.ok(dashUi.includes('hubSubcategorySelect'), 'type filter is a select dropdown');
  assert.ok(dashUi.includes('renderHubFilterSelectOptions'), 'select options helper present');
  assert.ok(!dashUi.includes('hub-filter-chip'), 'flat platform/type chip buttons removed');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.ok(css.includes('.hub-filter-selects'), 'compact select row styles');
  assert.ok(!css.includes('.hub-filter-chip'), 'chip button styles removed');
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
  assert.ok(dash.includes('requestHubPurchaseUnlock'), 'Buy opens secure PIN/biometric confirm');
  assert.ok(dash.includes('queueSensitiveAction'), 'pending purchase after unlock');
  assert.ok(dash.includes('runPendingSensitiveAction'), 'resume purchase after PIN/biometrics');
  assert.ok(dash.includes("reason: 'purchase'") || dash.includes('reason === \'purchase\''), 'purchase unlock context');
  assert.ok(
    /if\s*\(!_skipUnlockGate\)\s*\{[\s\S]*requestHubPurchaseUnlock/.test(dash),
    'Buy always prompts PIN/biometrics before charge'
  );
  assert.ok(!dash.includes('/api/kripicard/services/purchase'), 'customer purchase API removed');
  assert.ok(i18n.includes('pin_unlock_purchase_title'));
  assert.ok(i18n.includes('pin_unlock_biometric'));
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.includes('pinUnlockBioBtn'), 'biometric confirm control in unlock modal');
  assert.ok(html.includes('pinUnlockModalClose'), 'unlock modal close control');
  assert.ok(css.includes('#pinUnlockModal') && /#pinUnlockModal\s*\{[^}]*z-index:\s*140/s.test(css), 'PIN modal stacks above Hub modal');
  assert.ok(dash.includes('hubPlatformSelect'), 'platform filter select');
  assert.ok(dash.includes('hubSubcategorySelect'), 'type filter select');
  assert.ok(dash.includes('hub-service-options'), 'service variation option chips');
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
  assert.ok(css.includes('hub-filter-selects'));
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
  assert.ok(!indexJs.includes("app.use('/api/kripicard/services'"), 'hub routes unmounted from the app');
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
  assert.ok(api.includes('fetchCompleteSmmCatalog'), 'SMM complete/paginated fetch');
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
    preloadAllCategoryCatalogs,
    clearCatalogCaches,
    quotePurchase,
    purchaseHubProduct,
  } = require('../src/services/kripicardHubService');
  const { mapPool, SMM_CONCURRENCY, clearMainCatalogCache } = require('../../lib/kripicardHubApi');
  const User = require('../src/models/User');
  const { creditUsdt } = require('../src/services/walletService');

  await initDb();
  clearCatalogCaches();
  clearMainCatalogCache();
  assert.ok(SMM_CONCURRENCY >= 1);

  const pooled = await mapPool([1, 2, 3, 4], 2, async (n) => n * 3);
  assert.deepStrictEqual(pooled, [3, 6, 9, 12], 'mapPool preserves order with concurrency');

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

  const eagerAll = await catalogForCategoryAsync('social_media', {});
  assert.ok(eagerAll.platforms.length >= 5, 'eager social catalog exposes many platforms');
  assert.strictEqual(eagerAll.source, 'fallback');
  // FORCE_FALLBACK catalogs must not be eagerly cached — the starter list is
  // intentionally tiny (~one row/platform) and would look permanently truncated.
  assert.notStrictEqual(eagerAll.cache, 'hit', 'fallback catalogs are not cached');
  const eagerFb = await catalogForCategoryAsync('social_media', { platform: 'facebook' });
  assert.ok(eagerFb.products.length >= 1);
  assert.ok(eagerFb.products.every((p) => p.platform_key === 'facebook'));
  assert.strictEqual(eagerFb.source, 'fallback');
  assert.notStrictEqual(eagerFb.cache, 'hit', 'second filter still skips caching fallback');

  const warmed = await preloadAllCategoryCatalogs({ concurrency: 3 });
  assert.strictEqual(warmed.length, 6);
  assert.ok(warmed.every((r) => r.ok), 'batch preload all Hub categories');

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
