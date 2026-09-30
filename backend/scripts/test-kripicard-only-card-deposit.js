#!/usr/bin/env node
/**
 * Assert card creation + deposit gateways are Kripicard-only (Bitnob retired).
 * Run: node backend/scripts/test-kripicard-only-card-deposit.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walkJsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'vendor' || name === 'uploads') continue;
      walkJsFiles(full, acc);
    } else if (/\.(js|html)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('no Bitnob service / client modules');
for (const rel of [
  'backend/src/services/bitnobService.js',
  'backend/src/services/bitnobCardService.js',
  'backend/src/services/bitnobDepositService.js',
  'backend/src/routes/bitnob.js',
  'lib/bitnob.js',
]) {
  assert.ok(!fs.existsSync(path.join(ROOT, rel)), `expected absent: ${rel}`);
}
console.log('ok');

section('runtime card + deposit sources never call Bitnob');
const runtimeRoots = [
  path.join(ROOT, 'backend/src'),
  path.join(ROOT, 'backend/public'),
  path.join(ROOT, 'lib'),
];
const allowedRel = new Set([
  // Guard helper intentionally names retired providers.
  path.join(ROOT, 'backend/src/services/kripicardOnlyGateways.js'),
]);
for (const root of runtimeRoots) {
  for (const file of walkJsFiles(root)) {
    if (allowedRel.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Allow the retirement error strings / comments that point users to Kripicard.
    const stripped = text
      .replace(/Bitnob is no longer supported[\s\S]{0,120}/gi, '')
      .replace(/Bitnob cards are no longer supported[\s\S]{0,120}/gi, '')
      .replace(/Bitnob \/ Standard[^\n]*/gi, '')
      .replace(/Bitnob \(Standard Card[^\n]*/gi, '')
      .replace(/Bitnob \(sometimes misspelled[^\n]*/gi, '')
      .replace(/['"]bitnob['"]/gi, '')
      .replace(/['"]bitnod['"]/gi, '')
      .replace(/p === 'bitnob'|p === 'bitnod'/g, '')
      .replace(/provider === 'bitnob'|provider === 'bitnod'/g, '')
      .replace(/BITNOB_RETIRED/g, '');
    assert.ok(
      !/bitnob|bitnod/i.test(stripped),
      `unexpected Bitnob reference in ${path.relative(ROOT, file)}`
    );
  }
}
console.log('ok');

section('card issue + deposit routes force Kripicard');
const instant = read('backend/src/routes/instantCard.js');
assert.ok(instant.includes('assertKripicardOnlyProvider'));
assert.ok(instant.includes("provider: 'kripicard'"));
assert.ok(instant.includes('purchaseKripicardFromUsdtWallet'));
assert.ok(!/bitnobService|createBitnob/i.test(instant));

const deposit = read('backend/src/routes/deposit.js');
assert.ok(deposit.includes('assertKripicardOnlyProvider'));
assert.ok(deposit.includes('createKripicardCryptoDeposit'));
assert.ok(deposit.includes("provider: 'kripicard'"));

const wallet = read('backend/src/services/kripicardCardWalletService.js');
assert.ok(wallet.includes("provider: 'kripicard'"));
assert.ok(wallet.includes('issueKripicardForUser') || wallet.includes('createcard'));
assert.ok(wallet.includes('BITNOB_RETIRED'));
console.log('ok');

section('guard helper rejects Bitnob / Bitnod / Standard');
{
  const {
    assertKripicardOnlyProvider,
    isRetiredCardDepositProvider,
  } = require('../src/services/kripicardOnlyGateways');
  assert.ok(isRetiredCardDepositProvider('bitnob'));
  assert.ok(isRetiredCardDepositProvider('Bitnod'));
  assert.ok(isRetiredCardDepositProvider('standard'));
  assert.ok(!isRetiredCardDepositProvider('kripicard'));
  assert.doesNotThrow(() => assertKripicardOnlyProvider({ provider: 'kripicard' }));
  assert.doesNotThrow(() => assertKripicardOnlyProvider({ amount: 20 }));
  assert.throws(
    () => assertKripicardOnlyProvider({ provider: 'bitnob' }),
    (err) => err && err.code === 'BITNOB_RETIRED'
  );
  assert.throws(
    () => assertKripicardOnlyProvider({ gateway: 'bitnod' }),
    (err) => err && err.code === 'BITNOB_RETIRED'
  );
}
console.log('ok');

section('env examples have no BITNOB_* keys');
assert.ok(!/BITNOB_/i.test(read('.env.example')));
assert.ok(!/BITNOB_/i.test(read('backend/.env.example')));
console.log('ok');

section('schema drop migration still retires Bitnob tables/columns');
const drop = read('backend/migrations/063_drop_bitnob_schema.sql');
assert.ok(drop.includes('DROP TABLE IF EXISTS bitnob_wallet_ledger'));
assert.ok(drop.includes('DROP COLUMN balance_bitnob_usdt'));
assert.ok(drop.includes('DROP COLUMN bitnob_customer_id'));
console.log('ok');

console.log('\nKripicard-only card/deposit gateway checks passed.');
