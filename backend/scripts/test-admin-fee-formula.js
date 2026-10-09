#!/usr/bin/env node
/**
 * USDT deposits charge fixed + percent with no fee floor.
 * Withdrawal and card reload still floor at their minimums.
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
    setSetting,
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

  await setSetting('deposit_service_fee_minimum_usdt', 5);

  const pricing = await getCardPricingSettings();
  assert.strictEqual(pricing.deposit_service_fee_fixed_usdt, 1);
  assert.strictEqual(pricing.deposit_service_fee_minimum_usdt, 5);
  assert.strictEqual(pricing.withdrawal_service_fee_fixed_usdt, 1);
  assert.strictEqual(pricing.card_reload_fee_minimum_usd, 4);

  const depositFees = await getDepositFeeSettings();
  assert.strictEqual(depositFees.deposit_service_fee_minimum_usdt, 0);
  assert.strictEqual(depositFees.payment_service_fee_minimum_usdt, 0);
  const added = calculateDepositFeeBreakdown(100, { currency: 'USDT', settings: depositFees });
  assert.strictEqual(added.fee_usdt, 3, 'deposit fee is fixed 1 + 2% and ignores a stored minimum');
  assert.strictEqual(added.net_usdt, 97);
  assert.strictEqual(added.fee_rule, 'fee = fixed + amount * percent/100');
  assert.strictEqual(added.used_minimum_fee, false);

  const belowOldFloor = calculateDepositFeeBreakdown(20, {
    currency: 'USDT',
    settings: {
      deposit_service_fee_mode: 'fixed_plus_percent',
      deposit_service_fee_fixed_usdt: 0,
      deposit_service_fee_percent: 2,
      deposit_service_fee_minimum_usdt: 5,
      payment_service_fee_minimum_usdt: 5,
    },
  });
  assert.strictEqual(belowOldFloor.fee_usdt, 0.4, '20 USDT at 2% is 0.40, not the stored minimum of 5');
  assert.strictEqual(belowOldFloor.net_usdt, 19.6);

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
