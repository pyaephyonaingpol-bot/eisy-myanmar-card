#!/usr/bin/env node
/**
 * Withdrawal fee/minimum settings must flow from admin DB config to user dashboard API + UI.
 * Run: node backend/scripts/test-withdrawal-fee-dashboard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testDashboardSourceUsesDynamicFees() {
  section('Dashboard preview uses dynamic withdrawal settings');
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '../public/i18n.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  assert.ok(dash.includes('calculateWithdrawFeePreviewClient'), 'shared fee preview helper');
  assert.ok(
    dash.includes('fees.withdrawal_service_fee_percent'),
    'preview prefers admin withdrawal_service_fee_percent'
  );
  assert.ok(
    !dash.includes("fees[feeTypeKey] === 'percent' ? 'percent' : 'fixed'"),
    'legacy per-network type override removed from preview'
  );
  assert.ok(dash.includes('loadWithdrawalFees({ force: true })'), 'withdraw modals force-refresh fees');
  assert.ok(dash.includes('updateWithdrawUsdtHint'), 'live withdraw hint updater');
  assert.ok(
    dash.includes('delete methodHint.dataset.i18n'),
    'method hint must not re-attach stale Fixed $2 i18n key'
  );
  assert.ok(!/Fixed \$2/i.test(i18n), 'i18n must not hardcode Fixed $2 withdrawal fee');
  assert.ok(!/Fixed \$2/i.test(html), 'index.html must not hardcode Fixed $2 withdrawal fee');
  console.log('ok');
}

function testWithdrawalFeesRouteSource() {
  section('GET /api/withdrawal/fees returns DB settings unchanged');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/withdrawal.js'), 'utf8');
  assert.ok(route.includes('fees: settings'), 'fees payload uses settings directly');
  assert.ok(route.includes('withdrawal_service_fee_percent: settings.withdrawal_service_fee_percent'));
  assert.ok(!route.includes("payment_service_fee_mode: 'fixed'"), 'fees no longer forced to fixed mode');
  assert.ok(!route.includes('payment_service_fee_percent: 0'), 'fees no longer zeroed out');
  console.log('ok');
}

function testClientPreviewIgnoresLegacyFixedType() {
  section('Client preview uses admin percent even if legacy type is fixed');
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  const start = dash.indexOf('calculateWithdrawFeePreviewClient(amountUsdt, fees, { network, method } = {})');
  assert.ok(start > 0, 'preview helper present');
  const end = dash.indexOf('\n  calculateWithdrawPreviewClient', start);
  const fnSrc = dash.slice(start, end > start ? end : start + 3500);
  const sandbox = { window: {}, Math, Number, String, console };
  const wrapped = `
    const Dashboard = {
      ${fnSrc}
    };
    const fees = {
      withdrawal_service_fee_mode: 'max_percent_or_min',
      withdrawal_service_fee_percent: 3,
      withdrawal_service_fee_minimum_usdt: 1,
      payment_service_fee_mode: 'max_percent_or_min',
      payment_service_fee_percent: 3,
      payment_service_fee_minimum_usdt: 1,
      usdt_withdraw_fee_trc20: 2,
      usdt_withdraw_fee_trc20_type: 'fixed',
      minimum_usdt_withdrawal: 10,
      mmk_to_usd_rate: 4500,
    };
    const preview = Dashboard.calculateWithdrawFeePreviewClient(100, fees, { network: 'TRC20', method: 'crypto' });
    ({ preview });
  `;
  const result = vm.runInNewContext(wrapped, sandbox);
  assert.ok(result.preview, 'preview returned');
  assert.strictEqual(result.preview.fee_usdt, 3, '100 USDT at 3% = $3 even when legacy type=fixed');
  assert.ok(String(result.preview.fee_label).includes('3%'), 'label shows 3%');
  assert.notStrictEqual(result.preview.fee_mode, 'fixed', 'must not fall back to fixed $2');
  console.log('ok');
}

async function testSettingsAndBreakdown() {
  section('Settings service applies percent fees and mirrors payment_service_fee_*');
  const dbFile = path.join(os.tmpdir(), `eisy-wd-fee-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/services/settingsService')];

  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    updateSettings,
    getWithdrawalFeeSettings,
    calculateWithdrawalBreakdown,
  } = require('../src/services/settingsService');

  await initDb();

  const db = getDb();
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES
      ('usdt_withdraw_fee_trc20', '2', datetime('now')),
      ('usdt_withdraw_fee_trc20_type', 'fixed', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  await updateSettings({
    withdrawal_service_fee_mode: 'max_percent_or_min',
    withdrawal_service_fee_percent: 3,
    withdrawal_service_fee_minimum_usdt: 1,
    minimum_usdt_withdrawal: 25,
    updated_by: 'test',
  });

  const settings = await getWithdrawalFeeSettings();
  assert.strictEqual(settings.payment_service_fee_percent, 3);
  assert.strictEqual(settings.withdrawal_service_fee_percent, 3);
  assert.strictEqual(settings.minimum_usdt_withdrawal, 25);
  assert.strictEqual(settings.usdt_withdraw_fee_trc20_type, 'percent');
  assert.strictEqual(settings.usdt_withdraw_fee_bank_type, 'percent');

  const rawPayment = await db.get(
    `SELECT value FROM app_settings WHERE key = 'payment_service_fee_percent'`
  );
  assert.strictEqual(String(rawPayment.value), '3', 'payment_service_fee_percent mirrored in DB');

  const bankBreakdown = calculateWithdrawalBreakdown(100, 'BANK', settings);
  assert.strictEqual(bankBreakdown.fee_usdt, 3, '100 USDT at 3% = 3 USDT fee');
  assert.strictEqual(bankBreakdown.minimum_usdt_withdrawal, 25);
  assert.ok(bankBreakdown.fee_label.includes('3%'), 'fee label shows percent');

  const trc20Breakdown = calculateWithdrawalBreakdown(100, 'TRC20', settings);
  assert.strictEqual(trc20Breakdown.fee_usdt, 3, 'TRC20 respects percent fee from admin');
  assert.ok(trc20Breakdown.fee_label.includes('3%'), 'TRC20 fee label shows percent');

  const staleSettings = {
    ...settings,
    usdt_withdraw_fee_trc20_type: 'fixed',
    usdt_withdraw_fee_trc20: 2,
  };
  const staleBreakdown = calculateWithdrawalBreakdown(100, 'TRC20', staleSettings);
  assert.strictEqual(staleBreakdown.fee_usdt, 3, 'scoped admin percent overrides stale fixed type');

  const belowMin = calculateWithdrawalBreakdown(20, 'BANK', settings);
  assert.strictEqual(belowMin.below_minimum, true);

  await closeDb();
  console.log('ok');
}

async function main() {
  testDashboardSourceUsesDynamicFees();
  testWithdrawalFeesRouteSource();
  testClientPreviewIgnoresLegacyFixedType();
  await testSettingsAndBreakdown();
  console.log('\nWithdrawal fee dashboard sync — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
