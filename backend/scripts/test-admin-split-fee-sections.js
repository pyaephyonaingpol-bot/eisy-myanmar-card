#!/usr/bin/env node
/**
 * Admin settings: deposit vs withdrawal fee sections are independent.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const settingsService = fs.readFileSync(path.join(ROOT, 'backend/src/services/settingsService.js'), 'utf8');

assert.ok(adminHtml.includes('Deposit &amp; card purchase fees'), 'deposit fee section label');
assert.ok(adminHtml.includes('id="settingDepositFeeMode"'), 'deposit fee mode field');
assert.ok(adminHtml.includes('id="settingDepositFeePercent"'), 'deposit fee percent field');
assert.ok(adminHtml.includes('id="settingDepositFeeMinUsdt"'), 'deposit fee min field');
assert.ok(!adminHtml.includes('id="settingPaymentFeeMode"'), 'legacy unified settings fee mode removed');
assert.ok(adminHtml.includes('Withdrawal fees'), 'withdrawal fee section label on overview');
assert.ok(adminHtml.includes('id="wrFeeMode"'), 'withdrawal fee mode field kept');

assert.ok(adminJs.includes('deposit_service_fee_mode'), 'admin saves deposit fee mode');
assert.ok(adminJs.includes('withdrawal_service_fee_mode'), 'admin saves withdrawal fee mode');
assert.ok(!adminJs.includes('settingPaymentFeeMode'), 'legacy settings fee handler removed');

assert.ok(settingsService.includes('getDepositFeeSettings'), 'deposit fee settings helper');
assert.ok(settingsService.includes('deposit_service_fee_mode'), 'deposit fee keys in settings service');
assert.ok(settingsService.includes('withdrawal_service_fee_mode'), 'withdrawal fee keys in settings service');

process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `eisy-split-fees-${Date.now()}.db`)}`;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

(async () => {
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const {
    updateSettings,
    getDepositFeeSettings,
    getWithdrawalFeeSettings,
    calculateDepositFeeBreakdown,
    calculateWithdrawalBreakdown,
  } = require('../src/services/settingsService');
  await updateSettings({
    deposit_service_fee_mode: 'off',
    deposit_service_fee_percent: 2,
    deposit_service_fee_minimum_usdt: 1,
    withdrawal_service_fee_mode: 'percent',
    withdrawal_service_fee_percent: 5,
    withdrawal_service_fee_minimum_usdt: 2,
    effective_date: '2026-08-31',
    updated_by: 'test',
  });

  const depositFees = await getDepositFeeSettings();
  assert.strictEqual(depositFees.deposit_service_fee_mode, 'off');
  assert.strictEqual(depositFees.payment_service_fee_mode, 'off');

  const withdrawalFees = await getWithdrawalFeeSettings();
  assert.strictEqual(withdrawalFees.withdrawal_service_fee_mode, 'percent');
  assert.strictEqual(withdrawalFees.payment_service_fee_mode, 'percent');
  assert.strictEqual(withdrawalFees.payment_service_fee_percent, 5);

  const depositBreakdown = calculateDepositFeeBreakdown(100, { currency: 'USDT', settings: depositFees });
  assert.strictEqual(depositBreakdown.fee_usdt, 0, 'deposit fee off => zero fee');

  const withdrawalBreakdown = calculateWithdrawalBreakdown(100, 'BANK', withdrawalFees);
  assert.strictEqual(withdrawalBreakdown.fee_usdt, 5, 'withdrawal 5% fee on 100 USDT');

  console.log('Separate deposit vs withdrawal admin fees — ok');
  await closeDb();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
