#!/usr/bin/env node
'use strict';

/**
 * Parser coverage for Kripicard BIN payloads.
 * Ensures active BINs (e.g. 441357) are extracted from heterogeneous shapes.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function extractActiveBins(payload) {
  delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
  const {
    unwrapBinList,
    normalizeBinEntry,
    isActiveBinEntry,
  } = require(path.join(ROOT, 'lib/kripicard'));
  const list = unwrapBinList(payload);
  return list
    .map(normalizeBinEntry)
    .filter(Boolean)
    .filter(isActiveBinEntry)
    .map((entry) => entry.bin);
}

function testDigitKeyedMap() {
  section('digit-keyed data map extracts 441357 and drops maintenance');
  const active = extractActiveBins({
    success: true,
    data: {
      441357: { status: 'active', brand: 'visa' },
      539502: { status: 'maintenance' },
      525847: { available: false },
    },
  });
  assert.deepStrictEqual(active.sort(), ['441357']);
  console.log('ok');
}

function testBankBinList() {
  section('bankBin / Bin / BIN fields with nested list');
  const active = extractActiveBins({
    success: true,
    data: {
      list: [
        { bankBin: 441357, status: 'AVAILABLE' },
        { Bin: '428803', bin_status: 'normal' },
        { BIN: '539502', status: 'under_maintenance' },
      ],
    },
  });
  assert.ok(active.includes('441357'));
  assert.ok(active.includes('428803'));
  assert.ok(!active.includes('539502'));
  console.log('ok');
}

function testCommaSeparatedAndItems() {
  section('comma-separated bins + items[] with bin_number');
  const csv = extractActiveBins({ success: true, bins: '441357,428803' });
  assert.deepStrictEqual(csv.sort(), ['428803', '441357']);

  const items = extractActiveBins({
    code: 0,
    data: {
      items: [
        { bin_number: '441357', is_available: true },
        { bin_number: '525847', is_available: false },
      ],
    },
  });
  assert.deepStrictEqual(items, ['441357']);
  console.log('ok');
}

async function testFetchAvailableBinsUsesParser() {
  section('fetchAvailableBins returns parsed active BINs');
  process.env.KRIPICARD_API_KEY = 'parser-test-key';
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        result: {
          available_bins: [
            { bankBin: '441357', status: 'active' },
            { bankBin: '493875', status: 'inactive' },
          ],
        },
      });
    },
  });

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    const { fetchAvailableBins } = require(path.join(ROOT, 'lib/kripicard'));
    const result = await fetchAvailableBins();
    assert.deepStrictEqual(result.bins, ['441357']);
    assert.ok(result.inactive_count >= 1);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testPricingOptionsSurface441357() {
  section('getKripicardBinOptions surfaces 441357 for the dropdown');
  process.env.KRIPICARD_API_KEY = 'parser-test-key';
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        data: {
          441357: { status: 'active' },
          539502: { status: 'maintenance' },
        },
      });
    },
  });

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
    const {
      getKripicardBinOptions,
      resetKripicardBinCacheForTests,
    } = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    resetKripicardBinCacheForTests();
    const opts = await getKripicardBinOptions({ forceRefresh: true });
    assert.ok(opts.bins.includes('441357'), `expected 441357 in ${JSON.stringify(opts.bins)}`);
    assert.ok(!opts.bins.includes('539502'));
    assert.strictEqual(opts.source, 'kripicard_api');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function main() {
  testDigitKeyedMap();
  testBankBinList();
  testCommaSeparatedAndItems();
  await testFetchAvailableBinsUsesParser();
  await testPricingOptionsSurface441357();
  console.log('\nAll Kripicard BIN parser tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
