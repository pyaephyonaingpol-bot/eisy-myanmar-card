/**
 * Client-side fee preview calculators (server remains source of truth).
 * window.EisyHooks.depositFees
 *
 * Modes (`payment_service_fee_mode`) mirror backend paymentFeeService:
 *   off | percent | fixed | max_percent_or_min (default)
 */
(function (root) {
  'use strict';

  root.EisyHooks = root.EisyHooks || {};

  const FEE_MODE = {
    OFF: 'off',
    PERCENT: 'percent',
    FIXED: 'fixed',
    MAX_PERCENT_OR_MIN: 'max_percent_or_min',
  };

  function cfg() {
    return (root.Eisy && root.Eisy.config) || {};
  }

  function normalizeFeeMode(raw) {
    const mode = String(raw || '').trim().toLowerCase();
    if (mode === 'disabled' || mode === 'none' || mode === '0') return FEE_MODE.OFF;
    if (mode === 'pct' || mode === 'percentage') return FEE_MODE.PERCENT;
    if (mode === 'flat' || mode === 'fixed_usdt') return FEE_MODE.FIXED;
    if (
      mode === 'max'
      || mode === 'max_percent_or_minimum'
      || mode === 'percent_with_minimum'
      || mode === 'legacy'
    ) {
      return FEE_MODE.MAX_PERCENT_OR_MIN;
    }
    if (
      mode === FEE_MODE.OFF
      || mode === FEE_MODE.PERCENT
      || mode === FEE_MODE.FIXED
      || mode === FEE_MODE.MAX_PERCENT_OR_MIN
    ) {
      return mode;
    }
    return FEE_MODE.MAX_PERCENT_OR_MIN;
  }

  function resolveMode(fees) {
    return normalizeFeeMode(fees?.payment_service_fee_mode);
  }

  function calcUsdtFee(amount, feePercent, minimumFee, mode) {
    if (mode === FEE_MODE.OFF) return 0;
    const percentFee = Math.round(amount * feePercent) / 100;
    if (mode === FEE_MODE.PERCENT) return Math.round(percentFee * 100) / 100;
    if (mode === FEE_MODE.FIXED) return Math.round(minimumFee * 100) / 100;
    return Math.round(Math.max(percentFee, minimumFee) * 100) / 100;
  }

  function usdtFeeLabel(mode, fee, feePercent, minimumFee, percentFee) {
    if (mode === FEE_MODE.OFF || !(fee > 0)) return 'No service fee';
    if (mode === FEE_MODE.FIXED) return `fixed $${Number(fee).toFixed(2)}`;
    if (mode === FEE_MODE.PERCENT) return `${feePercent}% ($${Number(fee).toFixed(2)})`;
    if (percentFee < minimumFee) {
      return `min $${minimumFee.toFixed(2)} (${feePercent}% = $${percentFee.toFixed(2)})`;
    }
    return `${feePercent}% ($${Number(fee).toFixed(2)})`;
  }

  function mmkFeeLabel(mode, fee, feePercent, minimumFee, percentFee) {
    if (mode === FEE_MODE.OFF || !(fee > 0)) return 'No service fee';
    if (mode === FEE_MODE.FIXED) return `fixed ${Math.round(fee).toLocaleString()} MMK`;
    if (mode === FEE_MODE.PERCENT) {
      return `${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`;
    }
    if (percentFee < minimumFee) {
      return `min ${minimumFee.toLocaleString()} MMK (${feePercent}% = ${percentFee.toLocaleString()} MMK)`;
    }
    return `${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`;
  }

  function calculateUsdtDepositFeePreview(amountUsdt, fees = {}) {
    const c = cfg();
    const amount = Math.round((Number(amountUsdt) || 0) * 100) / 100;
    if (!(amount > 0)) return null;
    const mode = resolveMode(fees);
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1);
    const percentFee = Math.round(amount * feePercent) / 100;
    const fee = calcUsdtFee(amount, feePercent, minimumFee, mode);
    const net = Math.round((amount - fee) * 100) / 100;
    return {
      amount_usdt: amount,
      fee_usdt: fee,
      net_usdt: net,
      fee_mode: mode,
      fee_label: usdtFeeLabel(mode, fee, feePercent, minimumFee, percentFee),
      invalid_net: net <= 0,
    };
  }

  function calculateMmkDepositFeePreview(amountMmk, fees = {}) {
    const c = cfg();
    const amount = Math.round(Number(amountMmk) || 0);
    if (!(amount > 0)) return null;
    const mode = resolveMode(fees);
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const rate = Number(fees.mmk_to_usd_rate || fees.usdt_to_mmk_rate || 4500);
    const minimumFee = Math.round(
      Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1) * rate
    );
    const percentFee = Math.round(amount * feePercent / 100);
    let fee = 0;
    if (mode === FEE_MODE.OFF) fee = 0;
    else if (mode === FEE_MODE.PERCENT) fee = percentFee;
    else if (mode === FEE_MODE.FIXED) fee = minimumFee;
    else fee = Math.max(percentFee, minimumFee);
    const net = amount - fee;
    return {
      amount_mmk: amount,
      fee_mmk: fee,
      net_mmk: net,
      fee_mode: mode,
      fee_label: mmkFeeLabel(mode, fee, feePercent, minimumFee, percentFee),
      invalid_net: net <= 0,
    };
  }

  function calculateWithdrawUsdtPreview(amountUsdt, fees = {}, { network = 'TRC20', method = 'crypto' } = {}) {
    const c = cfg();
    const amount = Math.round((Number(amountUsdt) || 0) * 100) / 100;
    if (!(amount > 0)) return null;
    const mode = resolveMode(fees);
    const feePercent = Number(fees.payment_service_fee_percent ?? c.DEFAULT_PAYMENT_SERVICE_FEE_PERCENT ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? c.DEFAULT_PAYMENT_SERVICE_FEE_MINIMUM_USDT ?? 1);
    const percentFee = Math.round(amount * feePercent) / 100;
    const feeUsdt = calcUsdtFee(amount, feePercent, minimumFee, mode);
    const net = Math.round((amount - feeUsdt) * 100) / 100;
    const min = Number(fees.minimum_usdt_withdrawal || c.DEFAULT_MINIMUM_USDT_WITHDRAWAL || 10);
    return {
      amount_usdt: amount,
      fee_usdt: feeUsdt,
      net_usdt: net,
      fee_percent: feePercent,
      fee_mode: mode,
      fee_label: usdtFeeLabel(mode, feeUsdt, feePercent, minimumFee, percentFee),
      minimum_usdt_withdrawal: min,
      below_minimum: amount < min,
      network: method === 'bank' ? 'BANK' : network,
      invalid_net: net <= 0,
    };
  }

  root.EisyHooks.depositFees = {
    FEE_MODE,
    normalizeFeeMode,
    calculateUsdtDepositFeePreview,
    calculateMmkDepositFeePreview,
    calculateWithdrawUsdtPreview,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
