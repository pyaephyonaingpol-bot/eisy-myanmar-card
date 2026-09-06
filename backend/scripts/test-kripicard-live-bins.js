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

  for (const legacy of ['539502', '525847', '441357', '493875', '428803', '493728']) {
    assert.ok(!html.includes(legacy), `HTML must not seed ${legacy}`);
    assert.ok(!dash.includes(`'${legacy}'`), `dashboard must not hardcode ${legacy}`);
  }
  assert.ok(!service.includes('DEFAULT_KRIPICARD_BINS'), 'built-in catalog removed');
  assert.ok(lib.includes('fetchAvailableBins'), 'lib fetches live BINs');
  assert.ok(lib.includes('/api/external/cards/bins'), 'bins endpoint wired');
  assert.ok(dash.includes('populateCardBinOptions'), 'dropdown populate helper');
  assert.ok(html.includes('Loading available BINs'), 'loading state in select');
  assert.ok(dash.includes('No active BINs available'), 'empty active-BIN state');
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

async function main() {
  testNoHardcodedLegacyBins();
  await testFilterAndPersistOptions();
  await testPricingOptionsUseLiveBins();
  console.log('\nAll Kripicard live BIN tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
