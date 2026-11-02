#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  isValidTronBase58Address,
  normalizeTronAddressOrNull,
  partitionCustodialAddressRows,
} = require('../src/lib/tronAddress');

assert.strictEqual(normalizeTronAddressOrNull(null), null);
assert.strictEqual(normalizeTronAddressOrNull(''), null);
assert.strictEqual(normalizeTronAddressOrNull('   '), null);
assert.strictEqual(normalizeTronAddressOrNull('not-an-address'), null);
assert.strictEqual(normalizeTronAddressOrNull('T123'), null);

const sample = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';
assert.ok(isValidTronBase58Address(sample));
assert.strictEqual(normalizeTronAddressOrNull(`  ${sample}  `), sample);

const { valid, invalid } = partitionCustodialAddressRows([
  { user_id: 1, address: sample },
  { user_id: 2, address: '' },
  { user_id: 3, address: null },
  { user_id: 4, address: 'bad' },
]);
assert.strictEqual(valid.length, 1);
assert.strictEqual(invalid.length, 3);

(async () => {
  const { fetchIncomingUsdtTransfers } = require('../src/services/tronOrderService');
  const empty = await fetchIncomingUsdtTransfers({ address: '  ' });
  assert.deepStrictEqual(empty, []);
  const bad = await fetchIncomingUsdtTransfers({ address: 'TXYZnotvalid' });
  assert.deepStrictEqual(bad, []);
  console.log('test-tron-address-filter: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
