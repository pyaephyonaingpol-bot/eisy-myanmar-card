#!/usr/bin/env node
/**
 * Withdrawal fee/minimum settings must flow from admin DB config to user dashboard API.
 * Run: node backend/scripts/test-withdrawal-fee-dashboard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testDashboardSourceUsesDynamicFees() {
  section('Dashboard preview uses dynamic withdrawal settings');
  const dash = fs.readFileSync(path.join(__dirname, '../../backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('calculateWithdrawFeePreviewClient'), 'shared fee preview helper');
  assert.ok(!dash.includes("mode = 'fixed';\n      feePercent = 0;\n      minimumFee = Number(fees.usdt_withdraw_fee_trc20"), 'TRC20 fixed override removed');
  assert.ok(dash.includes('loadWithdrawalFees({ force: true })'), 'withdraw modals force-refresh fees');
  assert.ok(dash.includes('payment_service_fee_percent'), 'preview reads admin fee percent');
  console.log('ok');
}

function testWithdrawalFeesRouteSource() {
  section('GET /api/withdrawal/fees returns DB settings unchanged');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/withdrawal.js'), 'utf8');
  assert.ok(route.includes('fees: settings'), 'fees payload uses settings directly');
  assert.ok(!route.includes("payment_service_fee_mode: 'fixed'"), 'fees no longer forced to fixed mode');
  assert.ok(!route.includes('payment_service_fee_percent: 0'), 'fees no longer zeroed out');
  console.log('ok');
}

async function testSettingsAndBreakdown() {
  section('Settings service applies percent fees and custom minimum');
  const dbFile = path.join(os.tmpdir(), `eisy-wd-fee-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/services/settingsService')];

  const { initDb, closeDb } = require('../src/db');
  const {
    updateSettings,
    getWithdrawalFeeSettings,
    calculateWithdrawalBreakdown,
  } = require('../src/services/settingsService');

  await initDb();
  await updateSettings({
    withdrawal_service_fee_mode: 'max_percent_or_min',
    withdrawal_service_fee_percent: 3,
    withdrawal_service_fee_minimum_usdt: 1,
    minimum_usdt_withdrawal: 25,
    updated_by: 'test',
  });

  const settings = await getWithdrawalFeeSettings();
  assert.strictEqual(settings.payment_service_fee_percent, 3);
  assert.strictEqual(settings.minimum_usdt_withdrawal, 25);
  assert.strictEqual(settings.usdt_withdraw_fee_trc20_type, 'percent');
  assert.strictEqual(settings.usdt_withdraw_fee_bank_type, 'percent');

  const bankBreakdown = calculateWithdrawalBreakdown(100, 'BANK', settings);
  assert.strictEqual(bankBreakdown.fee_usdt, 3, '100 USDT at 3% = 3 USDT fee');
  assert.strictEqual(bankBreakdown.minimum_usdt_withdrawal, 25);
  assert.ok(bankBreakdown.fee_label.includes('3%'), 'fee label shows percent');

  const trc20Breakdown = calculateWithdrawalBreakdown(100, 'TRC20', settings);
  assert.strictEqual(trc20Breakdown.fee_usdt, 3, 'TRC20 respects percent fee from admin');
  assert.ok(trc20Breakdown.fee_label.includes('3%'), 'TRC20 fee label shows percent');

  const belowMin = calculateWithdrawalBreakdown(20, 'BANK', settings);
  assert.strictEqual(belowMin.below_minimum, true);

  await closeDb();
  console.log('ok');
}

async function main() {
  testDashboardSourceUsesDynamicFees();
  testWithdrawalFeesRouteSource();
  await testSettingsAndBreakdown();
  console.log('\nWithdrawal fee dashboard sync — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
