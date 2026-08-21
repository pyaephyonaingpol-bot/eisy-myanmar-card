#!/usr/bin/env node
/**
 * Unit tests for optional service fee / markup modes.
 * Run: node backend/scripts/test-payment-service-fee-modes.js
 */
'use strict';

const assert = require('assert');
const {
  FEE_MODES,
  calculatePaymentServiceFee,
  calculateUsdtPaymentFeeBreakdown,
  calculateMmkPaymentFeeBreakdown,
  normalizeFeeMode,
} = require('../src/services/paymentFeeService');

function settings(overrides = {}) {
  return {
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 1,
    payment_service_fee_mode: FEE_MODES.MAX_PERCENT_OR_MIN,
    mmk_to_usd_rate: 4500,
    ...overrides,
  };
}

function main() {
  assert.strictEqual(normalizeFeeMode('disabled'), FEE_MODES.OFF);
  assert.strictEqual(normalizeFeeMode('pct'), FEE_MODES.PERCENT);
  assert.strictEqual(normalizeFeeMode('flat'), FEE_MODES.FIXED);
  assert.strictEqual(normalizeFeeMode('legacy'), FEE_MODES.MAX_PERCENT_OR_MIN);
  assert.strictEqual(normalizeFeeMode('bogus'), FEE_MODES.MAX_PERCENT_OR_MIN);

  // Legacy default: max(2% of 50 = 1, min 1) = 1
  assert.strictEqual(
    calculatePaymentServiceFee(50, { feePercent: 2, minimumFee: 1, mode: FEE_MODES.MAX_PERCENT_OR_MIN }),
    1
  );
  // 2% of 100 = 2 > min 1
  assert.strictEqual(
    calculatePaymentServiceFee(100, { feePercent: 2, minimumFee: 1, mode: FEE_MODES.MAX_PERCENT_OR_MIN }),
    2
  );

  assert.strictEqual(
    calculatePaymentServiceFee(100, { feePercent: 2, minimumFee: 1, mode: FEE_MODES.OFF }),
    0
  );
  assert.strictEqual(
    calculatePaymentServiceFee(100, { feePercent: 2, minimumFee: 5, mode: FEE_MODES.PERCENT }),
    2
  );
  assert.strictEqual(
    calculatePaymentServiceFee(100, { feePercent: 2, minimumFee: 5, mode: FEE_MODES.FIXED }),
    5
  );

  const off = calculateUsdtPaymentFeeBreakdown(50, settings({ payment_service_fee_mode: 'off' }));
  assert.strictEqual(off.fee_usdt, 0);
  assert.strictEqual(off.net_usdt, 50);
  assert.strictEqual(off.fee_mode, 'off');
  assert.strictEqual(off.fee_enabled, false);

  const pct = calculateUsdtPaymentFeeBreakdown(50, settings({
    payment_service_fee_mode: 'percent',
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 5,
  }));
  assert.strictEqual(pct.fee_usdt, 1);
  assert.strictEqual(pct.net_usdt, 49);

  const fixed = calculateUsdtPaymentFeeBreakdown(50, settings({
    payment_service_fee_mode: 'fixed',
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 3,
  }));
  assert.strictEqual(fixed.fee_usdt, 3);
  assert.strictEqual(fixed.net_usdt, 47);

  const maxMode = calculateUsdtPaymentFeeBreakdown(50, settings({
    payment_service_fee_mode: 'max_percent_or_min',
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 1,
  }));
  assert.strictEqual(maxMode.fee_usdt, 1);
  assert.strictEqual(maxMode.net_usdt, 49);

  const mmkFixed = calculateMmkPaymentFeeBreakdown(100000, settings({
    payment_service_fee_mode: 'fixed',
    payment_service_fee_minimum_usdt: 1,
    mmk_to_usd_rate: 4500,
  }));
  assert.strictEqual(mmkFixed.fee_mmk, 4500);
  assert.strictEqual(mmkFixed.net_mmk, 95500);

  const mmkOff = calculateMmkPaymentFeeBreakdown(100000, settings({
    payment_service_fee_mode: 'off',
  }));
  assert.strictEqual(mmkOff.fee_mmk, 0);
  assert.strictEqual(mmkOff.net_mmk, 100000);

  console.log('payment service fee mode tests passed.');
}

main();
