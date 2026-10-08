#!/usr/bin/env node
/**
 * Withdrawal markup: 4% (3% network + 1% platform) + 48h processing SLA.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  NETWORK_FEE_PERCENT,
  PLATFORM_WITHDRAW_MARGIN_PERCENT,
  WITHDRAW_MARKUP_PERCENT,
  WITHDRAW_PROCESSING_HOURS,
  WITHDRAW_PAYOUT_PROVIDER,
  splitWithdrawMarkup,
} = require('../src/constants/withdrawMarkupPolicy');
const { calculateWithdrawalBreakdown } = require('../src/services/settingsService');

assert.strictEqual(NETWORK_FEE_PERCENT, 3);
assert.strictEqual(PLATFORM_WITHDRAW_MARGIN_PERCENT, 1);
assert.strictEqual(WITHDRAW_MARKUP_PERCENT, 4);
assert.strictEqual(WITHDRAW_PROCESSING_HOURS, 48);
assert.strictEqual(WITHDRAW_PAYOUT_PROVIDER, 'platform');

const split = splitWithdrawMarkup(100);
assert.strictEqual(split.fee_usdt, 4);
assert.strictEqual(split.network_fee_usdt, 3);
assert.strictEqual(split.platform_margin_usdt, 1);
assert.ok(split.fee_label.includes('4%'));
assert.ok(split.processing_label.includes('48'));

const settings = {
  withdrawal_service_fee_mode: 'percent',
  withdrawal_service_fee_percent: 4,
  withdrawal_service_fee_minimum_usdt: 0,
  payment_service_fee_mode: 'percent',
  payment_service_fee_percent: 4,
  payment_service_fee_minimum_usdt: 0,
  usdt_withdraw_fee_trc20_type: 'percent',
  usdt_withdraw_fee_trc20: 4,
  minimum_usdt_withdrawal: 10,
  mmk_to_usd_rate: 4500,
};

const trc20 = calculateWithdrawalBreakdown(100, 'TRC20', settings);
assert.strictEqual(trc20.fee_usdt, 4);
assert.strictEqual(trc20.net_usdt, 96);
assert.strictEqual(trc20.network_fee_usdt, 3);
assert.strictEqual(trc20.platform_margin_usdt, 1);
assert.strictEqual(trc20.processing_hours, 48);
assert.strictEqual(trc20.payout_provider, 'platform');
assert.ok(trc20.fee_label.includes('4%'));
assert.ok(trc20.summary.includes('48'));

const bank = calculateWithdrawalBreakdown(100, 'BANK', settings);
assert.strictEqual(bank.fee_usdt, 4);
assert.strictEqual(bank.net_usdt, 96);
assert.strictEqual(bank.amount_mmk, 96 * 4500);
assert.ok(bank.summary.includes('48'));

const drifted = calculateWithdrawalBreakdown(100, 'TRC20', {
  ...settings,
  withdrawal_service_fee_percent: 2,
  withdrawal_service_fee_fixed_usdt: 1,
  withdrawal_service_fee_minimum_usdt: 0,
  payment_service_fee_percent: 2,
  usdt_withdraw_fee_trc20: 2,
  usdt_withdraw_fee_trc20_type: 'fixed',
  withdrawal_service_fee_mode: 'fixed',
  payment_service_fee_mode: 'fixed',
});
assert.strictEqual(drifted.fee_usdt, 3, 'admin fixed 1 + 2% replaces the old forced 4%');
assert.strictEqual(drifted.net_usdt, 97);
assert.strictEqual(drifted.processing_hours, 48);
assert.strictEqual(drifted.payout_provider, 'platform');

const svc = fs.readFileSync(path.join(__dirname, '../src/services/withdrawalService.js'), 'utf8');
assert.ok(svc.includes('WITHDRAW_PROCESSING_HOURS'), 'service references 48h constant');
assert.ok(svc.includes('payout_provider: WITHDRAW_PAYOUT_PROVIDER'), 'platform payout provider');

const settingsSrc = fs.readFileSync(path.join(__dirname, '../src/services/settingsService.js'), 'utf8');
assert.ok(settingsSrc.includes('fixed_plus_percent'), 'withdrawal fee uses admin fixed + percent');
assert.ok(!settingsSrc.includes('forcedSettings'), 'admin withdrawal settings are not overwritten');
assert.ok(fs.existsSync(path.join(__dirname, '../src/constants/withdrawMarkupPolicy.js')));

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('data-payout-system="tron"'));
assert.ok(html.includes('value="TRC20"'));

console.log('Withdraw fee 4% + 48h — ok');
