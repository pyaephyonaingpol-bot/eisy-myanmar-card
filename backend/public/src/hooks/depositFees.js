/**
 * Client-side fee preview calculators (server remains source of truth).
 * window.EisyHooks.depositFees
 */
(function (root) {
  'use strict';

  root.EisyHooks = root.EisyHooks || {};

  function cfg() {
    return (root.Eisy && root.Eisy.config) || {};
  }

  function calculateUsdtDepositFeePreview(amountUsdt, fees = {}) {
    const c = cfg();
    const amount = Math.round((Number(amountUsdt) || 0) * 100) / 100;
    if (!(amount > 0)) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1);
    const percentFee = Math.round(amount * feePercent) / 100;
    const fee = Math.round(Math.max(percentFee, minimumFee) * 100) / 100;
    const net = Math.round((amount - fee) * 100) / 100;
    return {
      amount_usdt: amount,
      fee_usdt: fee,
      net_usdt: net,
      fee_label: percentFee < minimumFee
        ? `min $${minimumFee.toFixed(2)} (2% = $${percentFee.toFixed(2)})`
        : `${feePercent}% ($${fee.toFixed(2)})`,
      invalid_net: net <= 0,
    };
  }

  function calculateMmkDepositFeePreview(amountMmk, fees = {}) {
    const c = cfg();
    const amount = Math.round(Number(amountMmk) || 0);
    if (!(amount > 0)) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const rate = Number(fees.mmk_to_usd_rate || 4500);
    const minimumFee = Math.round(Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1) * rate);
    const percentFee = Math.round(amount * feePercent / 100);
    const fee = Math.max(percentFee, minimumFee);
    const net = amount - fee;
    return {
      amount_mmk: amount,
      fee_mmk: fee,
      net_mmk: net,
      fee_label: percentFee < minimumFee
        ? `min ${minimumFee.toLocaleString()} MMK (${feePercent}% = ${percentFee.toLocaleString()} MMK)`
        : `${feePercent}% (${fee.toLocaleString()} MMK)`,
      invalid_net: net <= 0,
    };
  }

  function calculateWithdrawUsdtPreview(amountUsdt, fees = {}, { network = 'TRC20', method = 'crypto' } = {}) {
    const c = cfg();
    const amount = Math.round((Number(amountUsdt) || 0) * 100) / 100;
    if (!(amount > 0)) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1);
    const percentFee = Math.round(amount * feePercent) / 100;
    let feeUsdt = Math.max(percentFee, minimumFee);
    feeUsdt = Math.round(feeUsdt * 100) / 100;
    const net = Math.round((amount - feeUsdt) * 100) / 100;
    const min = Number(fees.minimum_usdt_withdrawal || c.DEFAULT_MINIMUM_USDT_WITHDRAWAL || 10);
    return {
      amount_usdt: amount,
      fee_usdt: feeUsdt,
      net_usdt: net,
      fee_percent: feePercent,
      fee_label: percentFee < minimumFee
        ? `min $${minimumFee.toFixed(2)}`
        : `${feePercent}% ($${feeUsdt.toFixed(2)})`,
      minimum_usdt_withdrawal: min,
      below_minimum: amount < min,
      network: method === 'bank' ? 'BANK' : network,
      invalid_net: net <= 0,
    };
  }

  root.EisyHooks.depositFees = {
    calculateUsdtDepositFeePreview,
    calculateMmkDepositFeePreview,
    calculateWithdrawUsdtPreview,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
