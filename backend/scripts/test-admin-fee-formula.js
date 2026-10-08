#!/usr/bin/env node
/**
 * Admin Fixed + Percentage with Minimum applies to deposit, withdrawal, and card reload.
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `eisy-fee-formula-${Date.now()}.db`)}`;
process.env.NODE_ENV = 'test';

(async () => {
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const {
    updateSettings,
    getCardPricingSettings,
    getDepositFeeSettings,
    getWithdrawalFeeSettings,
    calculateDepositFeeBreakdown,
    calculateWithdrawalBreakdown,
    calculateCardReloadPricingUsdt,
  } = require('../src/services/settingsService');

  await updateSettings({
    deposit_service_fee_mode: 'fixed_plus_percent',
    deposit_service_fee_fixed_usdt: 1,
    deposit_service_fee_percent: 2,
    deposit_service_fee_minimum_usdt: 5,
    withdrawal_service_fee_mode: 'fixed_plus_percent',
    withdrawal_service_fee_fixed_usdt: 1,
    withdrawal_service_fee_percent: 2,
    withdrawal_service_fee_minimum_usdt: 0,
    card_reload_fee_usd: 1,
    card_reload_fee_percent: 2,
    card_reload_fee_minimum_usd: 4,
    minimum_usdt_reload: 5,
    effective_date: '2026-10-08',
    updated_by: 'test',
  });

  const pricing = await getCardPricingSettings();
  assert.strictEqual(pricing.deposit_service_fee_fixed_usdt, 1);
  assert.strictEqual(pricing.withdrawal_service_fee_fixed_usdt, 1);
  assert.strictEqual(pricing.card_reload_fee_minimum_usd, 4);

  const depositFees = await getDepositFeeSettings();
  const floored = calculateDepositFeeBreakdown(100, { currency: 'USDT', settings: depositFees });
  assert.strictEqual(floored.fee_usdt, 5, 'deposit fee floors at the minimum');

  await updateSettings({
    deposit_service_fee_minimum_usdt: 0,
    effective_date: '2026-10-08',
    updated_by: 'test',
  });
  const depositOpen = await getDepositFeeSettings();
  const added = calculateDepositFeeBreakdown(100, { currency: 'USDT', settings: depositOpen });
  assert.strictEqual(added.fee_usdt, 3, 'deposit fee is fixed 1 + 2%');
  assert.strictEqual(added.net_usdt, 97);

  const withdrawalFees = await getWithdrawalFeeSettings();
  const withdrawal = calculateWithdrawalBreakdown(100, 'TRC20', withdrawalFees);
  assert.strictEqual(withdrawal.fee_usdt, 3, 'withdrawal uses admin fixed + percent');
  assert.strictEqual(withdrawal.net_usdt, 97);
  assert.strictEqual(withdrawal.processing_hours, 48);

  const reloadPricing = await getCardPricingSettings();
  const reload = calculateCardReloadPricingUsdt(100, reloadPricing);
  assert.strictEqual(reload.reload_fee_usd, 4, 'reload fee floors at the minimum');
  assert.strictEqual(reload.deposit_usdt, 104);

  await updateSettings({
    card_reload_fee_minimum_usd: 0,
    effective_date: '2026-10-08',
    updated_by: 'test',
  });
  const reloadOpen = calculateCardReloadPricingUsdt(100, await getCardPricingSettings());
  assert.strictEqual(reloadOpen.reload_fee_usd, 3, 'reload fee is fixed 1 + 2%');
  assert.strictEqual(reloadOpen.deposit_usdt, 103);

  console.log('Admin fee formula — ok');
  await closeDb();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
