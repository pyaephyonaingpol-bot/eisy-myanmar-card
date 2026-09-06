#!/usr/bin/env node
'use strict';

/**
 * Live Kripicard BIN catalog:
 * fetch /api/external/cards/bins, filter inactive/maintenance,
 * and expose only active BINs to Apply Card pricing/dropdown.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testNoHardcodedLegacyBins() {
  section('UI/service no longer hardcode legacy inactive BINs');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  const service = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/cardWalletService.js'),
    'utf8'
  );
  const lib = fs.readFileSync(path.join(ROOT, 'lib/kripicard.js'), 'utf8');

  // Stale multi-BIN catalog must stay out of HTML/dashboard. Known-active
  // US BIN 441357 may exist as a backend builtin_fallback only.
  for (const legacy of ['539502', '525847', '493875', '428803', '493728']) {
    assert.ok(!html.includes(legacy), `HTML must not seed ${legacy}`);
    assert.ok(!dash.includes(`'${legacy}'`), `dashboard must not hardcode ${legacy}`);
  }
  assert.ok(!html.includes('value="441357"'), 'HTML must not seed fallback BIN 441357 as an option value');
  assert.ok(!html.includes('>441357<'), 'HTML must not seed fallback BIN 441357 as option text');
  assert.ok(!dash.includes("'441357'"), 'dashboard must not hardcode fallback BIN option');
  assert.ok(!service.includes('DEFAULT_KRIPICARD_BINS'), 'old multi-BIN built-in catalog removed');
  assert.ok(service.includes('KRIPICARD_KNOWN_ACTIVE_BIN_CATALOG'), 'known-active fallback catalog present');
  assert.ok(service.includes("'441357'"), 'fallback catalog defines US BIN 441357');
  assert.ok(service.includes('builtin_fallback'), 'builtin_fallback source wired');
  assert.ok(lib.includes('fetchAvailableBins'), 'lib fetches live BINs');
  assert.ok(lib.includes('/api/external/cards/bins'), 'bins endpoint wired');
  assert.ok(dash.includes('populateCardBinOptions'), 'dropdown populate helper');
  assert.ok(html.includes('Loading available BINs'), 'loading state in select');
  assert.ok(dash.includes('No active BINs available'), 'empty active-BIN state');
  assert.ok(dash.includes("source === 'env_fallback'"), 'UI must ignore env_fallback BIN lists');
  console.log('ok');
}

async function testFilterAndPersistOptions() {
  section('fetchAvailableBins filters maintenance/inactive');
  process.env.KRIPICARD_API_KEY = 'live-bins-test-key';
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;

  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: [
            { bin: '411111', status: 'active' },
            { bin: '539502', status: 'maintenance' },
            { bin: '525847', available: false },
            { bank_bin: '400333', state: 'available' },
          ],
        });
      },
    };
  };

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    const { fetchAvailableBins } = require(path.join(ROOT, 'lib/kripicard'));
    const result = await fetchAvailableBins();
    assert.ok(captured.url.includes('/api/external/cards/bins'));
    assert.ok(captured.url.includes('api_key=live-bins-test-key'));
    assert.strictEqual(captured.opts.method, 'GET');
    assert.ok(String(captured.opts.headers.Authorization || '').includes('Bearer live-bins-test-key'));
    assert.deepStrictEqual([...result.bins].sort(), ['400333', '411111']);
    assert.ok(result.inactive_count >= 2);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testPricingOptionsUseLiveBins() {
  section('getKripicardBinOptions uses live active BINs');
  process.env.KRIPICARD_API_KEY = 'live-bins-test-key';
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        bins: [
          { bin: '422222', status: 'active' },
          { bin: '539502', status: 'inactive' },
        ],
      });
    },
  });

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
    const {
      getKripicardBinOptions,
      resolveKripicardBin,
      resetKripicardBinCacheForTests,
    } = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    resetKripicardBinCacheForTests();
    const opts = await getKripicardBinOptions({ forceRefresh: true });
    assert.deepStrictEqual(opts.bins, ['422222']);
    assert.strictEqual(opts.source, 'kripicard_api');
    assert.strictEqual(await resolveKripicardBin(), '422222');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}


async function testEnvAllowListDoesNotReplaceLiveCatalog() {
  section('KRIPICARD_ALLOWED_BINS must not reintroduce stale BINs when API is down');
  process.env.KRIPICARD_API_KEY = 'live-bins-test-key';
  process.env.KRIPICARD_ALLOWED_BINS = '539502,525847,441357';
  process.env.KRIPICARD_DEFAULT_BIN = '539502';

  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new Error('network down');
    err.code = 'KRIPICARD_NETWORK';
    throw err;
  };

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
    const {
      getKripicardBinOptions,
      resetKripicardBinCacheForTests,
    } = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    resetKripicardBinCacheForTests();
    const opts = await getKripicardBinOptions({ forceRefresh: true });
    // Must NOT revive the stale env allow-list (539502/525847).
    // May use the known-active builtin fallback (441357) so Apply Card still works.
    assert.ok(!opts.bins.includes('539502'), 'stale BIN 539502 must not appear');
    assert.ok(!opts.bins.includes('525847'), 'stale BIN 525847 must not appear');
    assert.notStrictEqual(opts.source, 'env_fallback');
    assert.notStrictEqual(opts.source, 'env');
    assert.deepStrictEqual(opts.bins, ['441357']);
    assert.strictEqual(opts.source, 'builtin_fallback');
    assert.strictEqual(opts.default_bin, '441357');
    assert.ok(opts.catalog?.[0]?.platform_markup_usd > 0, 'fallback includes platform markup');
    assert.ok(opts.catalog?.[0]?.min_load_usd > 0, 'fallback includes min load fee structure');
  } finally {
    global.fetch = originalFetch;
    delete process.env.KRIPICARD_ALLOWED_BINS;
    delete process.env.KRIPICARD_DEFAULT_BIN;
  }
  console.log('ok');
}


async function testBuiltinFallbackWhenLiveEmpty() {
  section('known-active US BIN 441357 fallback when live catalog is empty');
  process.env.KRIPICARD_API_KEY = 'live-bins-test-key';
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ success: true, data: [] });
    },
  });

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
    const {
      getKripicardBinOptions,
      resolveKripicardBin,
      resetKripicardBinCacheForTests,
      buildKnownActiveBinFallback,
    } = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    resetKripicardBinCacheForTests();

    const priced = buildKnownActiveBinFallback({
      minimum_initial_deposit_usd: 10,
      card_issuance_fee_usd: 5,
    });
    assert.deepStrictEqual(priced.bins, ['441357']);
    assert.strictEqual(priced.catalog[0].issuance_fee_usd, 5);
    assert.strictEqual(priced.catalog[0].platform_markup_usd, 5);
    assert.strictEqual(priced.catalog[0].min_load_usd, 10);
    assert.strictEqual(priced.catalog[0].country, 'US');

    const opts = await getKripicardBinOptions({
      forceRefresh: true,
      pricingSettings: { minimum_initial_deposit_usd: 10, card_issuance_fee_usd: 5 },
    });
    assert.deepStrictEqual(opts.bins, ['441357']);
    assert.strictEqual(opts.source, 'builtin_fallback');
    assert.strictEqual(await resolveKripicardBin(), '441357');
    assert.strictEqual(await resolveKripicardBin('441357'), '441357');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function main() {
  testNoHardcodedLegacyBins();
  await testFilterAndPersistOptions();
  await testPricingOptionsUseLiveBins();
  await testEnvAllowListDoesNotReplaceLiveCatalog();
  await testBuiltinFallbackWhenLiveEmpty();
  console.log('\nAll Kripicard live BIN tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
