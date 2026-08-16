#!/usr/bin/env node
/**
 * Unit checks for USDT auto-deposit verification helpers + auto-withdraw safety gate.
 * Run: node backend/scripts/test-usdt-auto-flow.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  amountWithinTolerance,
  isMockTxHash,
} = require('../src/services/usdtBlockchainService');
const {
  evaluateAutoWithdrawEligibility,
  isUsdtAutoWithdrawEnabled,
  getUsdtAutoWithdrawMaxUsdt,
} = require('../src/services/withdrawalService');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function main() {
  section('Auto-withdraw env defaults');
  const prevEnabled = process.env.USDT_AUTO_WITHDRAW_ENABLED;
  const prevMax = process.env.USDT_AUTO_WITHDRAW_MAX_USDT;
  delete process.env.USDT_AUTO_WITHDRAW_ENABLED;
  delete process.env.USDT_AUTO_WITHDRAW_MAX_USDT;
  assert.strictEqual(isUsdtAutoWithdrawEnabled(), true, 'auto-withdraw on by default');
  assert.strictEqual(getUsdtAutoWithdrawMaxUsdt(), 100, 'default safety cap is $100');

  process.env.USDT_AUTO_WITHDRAW_ENABLED = 'false';
  assert.strictEqual(isUsdtAutoWithdrawEnabled(), false);
  process.env.USDT_AUTO_WITHDRAW_ENABLED = 'true';
  process.env.USDT_AUTO_WITHDRAW_MAX_USDT = '50';
  assert.strictEqual(getUsdtAutoWithdrawMaxUsdt(), 50);
  console.log('ok');

  section('Safety threshold flags large TRC20 withdrawals for admin');
  process.env.USDT_AUTO_WITHDRAW_ENABLED = 'true';
  process.env.USDT_AUTO_WITHDRAW_MAX_USDT = '100';

  const small = evaluateAutoWithdrawEligibility({
    payout_method: 'crypto',
    network: 'TRC20',
    amount_usdt: 50,
  });
  assert.strictEqual(small.eligible, true);
  assert.strictEqual(small.reason, 'within_threshold');

  const large = evaluateAutoWithdrawEligibility({
    payout_method: 'crypto',
    network: 'TRC20',
    amount_usdt: 250,
  });
  assert.strictEqual(large.eligible, false);
  assert.strictEqual(large.reason, 'above_threshold');

  const bep20 = evaluateAutoWithdrawEligibility({
    payout_method: 'crypto',
    network: 'BEP20',
    amount_usdt: 20,
  });
  assert.strictEqual(bep20.eligible, false);
  assert.strictEqual(bep20.reason, 'network_manual');

  const bank = evaluateAutoWithdrawEligibility({
    payout_method: 'bank',
    network: 'BANK',
    amount_usdt: 20,
  });
  assert.strictEqual(bank.eligible, false);
  assert.strictEqual(bank.reason, 'network_manual');
  console.log('ok');

  section('Deposit amount tolerance still sane');
  assert.ok(amountWithinTolerance(25, 25));
  assert.ok(amountWithinTolerance(25.05, 25));
  assert.ok(!amountWithinTolerance(30, 25));
  assert.ok(isMockTxHash('test_tx_hash'));
  assert.ok(!isMockTxHash('a'.repeat(64)));
  console.log('ok');

  if (prevEnabled === undefined) delete process.env.USDT_AUTO_WITHDRAW_ENABLED;
  else process.env.USDT_AUTO_WITHDRAW_ENABLED = prevEnabled;
  if (prevMax === undefined) delete process.env.USDT_AUTO_WITHDRAW_MAX_USDT;
  else process.env.USDT_AUTO_WITHDRAW_MAX_USDT = prevMax;

  console.log('\nAll USDT auto-flow checks passed.');
}

main();
