/**
 * Unified payment service fee / markup for Deposit + Withdrawal.
 *
 * Modes (`payment_service_fee_mode`):
 *   - off                 → no fee (0)
 *   - percent             → amount × percent/100
 *   - fixed               → flat minimum_usdt (MMK uses $min × rate)
 *   - max_percent_or_min  → Math.max(percent, minimum)  [legacy]
 *   - fixed_plus_percent  → Math.max(fixed + amount × percent/100, minimum)
 */

const DEFAULT_FEE_PERCENT = 2;
const DEFAULT_MINIMUM_FEE_USDT = 1;
const DEFAULT_FEE_MODE = 'max_percent_or_min';

const FEE_MODES = Object.freeze({
  OFF: 'off',
  PERCENT: 'percent',
  FIXED: 'fixed',
  MAX_PERCENT_OR_MIN: 'max_percent_or_min',
  FIXED_PLUS_PERCENT: 'fixed_plus_percent',
});

function roundMoney(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeFeeMode(raw) {
  const mode = String(raw || DEFAULT_FEE_MODE).trim().toLowerCase();
  if (mode === 'disabled' || mode === 'none' || mode === '0') return FEE_MODES.OFF;
  if (mode === 'pct' || mode === 'percentage') return FEE_MODES.PERCENT;
  if (mode === 'flat' || mode === 'fixed_usdt') return FEE_MODES.FIXED;
  if (
    mode === 'fixed_plus_percent'
    || mode === 'fixed+percent'
    || mode === 'fixed_and_percent'
    || mode === 'fixed_plus_percentage'
  ) {
    return FEE_MODES.FIXED_PLUS_PERCENT;
  }
  if (
    mode === 'max'
    || mode === 'max_percent_or_minimum'
    || mode === 'percent_with_minimum'
    || mode === 'legacy'
  ) {
    return FEE_MODES.MAX_PERCENT_OR_MIN;
  }
  if (Object.values(FEE_MODES).includes(mode)) return mode;
  return DEFAULT_FEE_MODE;
}

function resolveFeeMode(settings) {
  return normalizeFeeMode(settings?.payment_service_fee_mode);
}

function resolveFeePercent(settings) {
  const raw = settings?.payment_service_fee_percent;
  const n = raw == null ? DEFAULT_FEE_PERCENT : parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FEE_PERCENT;
}

function resolveFixedFeeUsdt(settings) {
  const mode = normalizeFeeMode(settings?.payment_service_fee_mode);
  if (mode !== FEE_MODES.FIXED_PLUS_PERCENT) return 0;
  const raw = settings?.payment_service_fee_fixed_usdt;
  if (raw == null || raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function resolveMinimumFeeUsdt(settings) {
  const mode = normalizeFeeMode(settings?.payment_service_fee_mode);
  const raw = settings?.payment_service_fee_minimum_usdt;
  // Legacy alias only. The fixed component of fixed_plus_percent is not a minimum.
  if ((raw == null || raw === '') && mode !== FEE_MODES.FIXED_PLUS_PERCENT) {
    const alias = settings?.payment_service_fee_fixed_usdt;
    if (alias != null && alias !== '') {
      const aliased = parseFloat(alias);
      if (Number.isFinite(aliased) && aliased >= 0) return aliased;
    }
  }
  const fallback = mode === FEE_MODES.FIXED_PLUS_PERCENT ? 0 : DEFAULT_MINIMUM_FEE_USDT;
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolveMinimumFeeMmk(settings) {
  const rate = parseFloat(settings?.mmk_to_usd_rate) || 4500;
  const minUsdt = resolveMinimumFeeUsdt(settings);
  return Math.round(minUsdt * rate);
}

/**
 * Core fee calculator with optional mode.
 * @param {number} amount
 * @param {{ feePercent?: number, minimumFee?: number, fixedFee?: number, decimals?: number, mode?: string }} [opts]
 */
function calculatePaymentServiceFee(amount, opts = {}) {
  const amt = Number(amount) || 0;
  if (!(amt > 0)) return 0;

  const mode = normalizeFeeMode(opts.mode ?? DEFAULT_FEE_MODE);
  if (mode === FEE_MODES.OFF) return 0;

  const feePercent = opts.feePercent != null ? Number(opts.feePercent) : DEFAULT_FEE_PERCENT;
  const minimumFee = opts.minimumFee != null ? Number(opts.minimumFee) : DEFAULT_MINIMUM_FEE_USDT;
  const fixedFee = opts.fixedFee != null ? Number(opts.fixedFee) : 0;
  const decimals = opts.decimals != null ? opts.decimals : 2;
  const percentFee = amt * ((Number.isFinite(feePercent) ? feePercent : 0) / 100);
  const min = Number.isFinite(minimumFee) ? minimumFee : 0;
  const fixed = Number.isFinite(fixedFee) && fixedFee > 0 ? fixedFee : 0;

  let fee = 0;
  if (mode === FEE_MODES.PERCENT) {
    fee = percentFee;
  } else if (mode === FEE_MODES.FIXED) {
    fee = min;
  } else if (mode === FEE_MODES.FIXED_PLUS_PERCENT) {
    fee = Math.max(fixed + percentFee, min);
  } else {
    // max_percent_or_min (legacy / default)
    fee = Math.max(percentFee, min);
  }

  return roundMoney(fee, decimals);
}

function buildFeeLabel({
  mode,
  fee,
  feePercent,
  minimumFee,
  fixedFee = 0,
  percentComponent,
  currency = 'USDT',
  usedMinimum = false,
}) {
  if (mode === FEE_MODES.OFF || !(fee > 0)) return 'No service fee';
  if (mode === FEE_MODES.FIXED_PLUS_PERCENT) {
    const fixed = Number(fixedFee) || 0;
    if (usedMinimum) {
      return currency === 'MMK'
        ? `min ${Math.round(minimumFee).toLocaleString()} MMK`
        : `min $${Number(minimumFee).toFixed(2)}`;
    }
    if (fixed > 0) {
      return currency === 'MMK'
        ? `fixed ${Math.round(fixed).toLocaleString()} MMK + ${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`
        : `$${fixed.toFixed(2)} + ${feePercent}% ($${Number(fee).toFixed(2)})`;
    }
    return currency === 'MMK'
      ? `${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`
      : `${feePercent}% ($${Number(fee).toFixed(2)})`;
  }
  if (mode === FEE_MODES.FIXED) {
    return currency === 'MMK'
      ? `fixed ${Math.round(fee).toLocaleString()} MMK`
      : `fixed $${Number(fee).toFixed(2)}`;
  }
  if (mode === FEE_MODES.PERCENT) {
    return currency === 'MMK'
      ? `${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`
      : `${feePercent}% ($${Number(fee).toFixed(2)})`;
  }
  if (usedMinimum) {
    return currency === 'MMK'
      ? `min ${Math.round(minimumFee).toLocaleString()} MMK (${feePercent}% = ${Math.round(percentComponent).toLocaleString()} MMK)`
      : `min $${Number(minimumFee).toFixed(2)} (${feePercent}% = $${Number(percentComponent).toFixed(2)})`;
  }
  return currency === 'MMK'
    ? `${feePercent}% (${Math.round(fee).toLocaleString()} MMK)`
    : `${feePercent}% ($${Number(fee).toFixed(2)})`;
}

/**
 * Full deposit/withdrawal breakdown for USDT (or USD-pegged) amounts.
 */
function calculateUsdtPaymentFeeBreakdown(amountUsdt, settings = {}) {
  const amount = roundMoney(amountUsdt, 2);
  if (!(amount > 0)) {
    throw new Error('Enter a valid amount');
  }

  const mode = resolveFeeMode(settings);
  const feePercent = resolveFeePercent(settings);
  const minimumFee = resolveMinimumFeeUsdt(settings);
  const fixedFee = resolveFixedFeeUsdt(settings);
  const fee = calculatePaymentServiceFee(amount, {
    feePercent,
    minimumFee,
    fixedFee,
    decimals: 2,
    mode,
  });
  const net = roundMoney(amount - fee, 2);
  const percentComponent = roundMoney(amount * (feePercent / 100), 2);
  const additive = roundMoney(fixedFee + percentComponent, 2);
  const usedMinimum = mode === FEE_MODES.FIXED_PLUS_PERCENT
    ? minimumFee > additive + 0.0001
    : mode === FEE_MODES.MAX_PERCENT_OR_MIN
      && (fee > percentComponent + 0.0001 || (fee === minimumFee && percentComponent < minimumFee));

  const feeRule = mode === FEE_MODES.OFF
    ? 'fee = 0'
    : mode === FEE_MODES.PERCENT
      ? 'fee = amount * feePercent/100'
      : mode === FEE_MODES.FIXED
        ? 'fee = fixedUsdt'
        : mode === FEE_MODES.FIXED_PLUS_PERCENT
          ? 'fee = max(fixed + amount * percent/100, minimum)'
          : 'Math.max(amount * feePercent/100, minimumFee)';

  return {
    amount,
    amount_usdt: amount,
    fee,
    fee_usdt: fee,
    net,
    net_usdt: net,
    fee_percent: feePercent,
    minimum_fee: minimumFee,
    minimum_fee_usdt: minimumFee,
    fixed_fee_usdt: mode === FEE_MODES.FIXED
      ? fee
      : mode === FEE_MODES.FIXED_PLUS_PERCENT
        ? fixedFee
        : minimumFee,
    percent_fee_usdt: percentComponent,
    used_minimum_fee: usedMinimum,
    fee_mode: mode,
    fee_type: mode,
    fee_enabled: mode !== FEE_MODES.OFF && fee > 0,
    fee_rule: feeRule,
    fee_label: buildFeeLabel({
      mode,
      fee,
      feePercent,
      minimumFee,
      fixedFee,
      percentComponent,
      currency: 'USDT',
      usedMinimum,
    }),
    invalid_net: net <= 0,
    summary: fee > 0
      ? `Gross $${amount.toFixed(2)} − fee $${fee.toFixed(2)} = net $${net.toFixed(2)}`
      : `Gross $${amount.toFixed(2)} (no service fee) = net $${net.toFixed(2)}`,
  };
}

/**
 * Full deposit/withdrawal breakdown for MMK amounts.
 * Fixed / minimum fee = $min equivalent at mmk_to_usd_rate.
 */
function calculateMmkPaymentFeeBreakdown(amountMmk, settings = {}) {
  const amount = Math.round(Number(amountMmk) || 0);
  if (!(amount > 0)) {
    throw new Error('Enter a valid MMK amount');
  }

  const mode = resolveFeeMode(settings);
  const feePercent = resolveFeePercent(settings);
  const minimumFee = resolveMinimumFeeMmk(settings);
  const rate = parseFloat(settings?.mmk_to_usd_rate) || 4500;
  const fixedFee = Math.round(resolveFixedFeeUsdt(settings) * rate);
  const fee = Math.round(calculatePaymentServiceFee(amount, {
    feePercent,
    minimumFee,
    fixedFee,
    decimals: 0,
    mode,
  }));
  const net = amount - fee;
  const percentComponent = Math.round(amount * (feePercent / 100));
  const additive = fixedFee + percentComponent;
  const usedMinimum = mode === FEE_MODES.FIXED_PLUS_PERCENT
    ? minimumFee > additive
    : mode === FEE_MODES.MAX_PERCENT_OR_MIN
      && fee >= minimumFee
      && percentComponent < minimumFee;

  const feeRule = mode === FEE_MODES.OFF
    ? 'fee = 0'
    : mode === FEE_MODES.PERCENT
      ? 'fee = amount * feePercent/100'
      : mode === FEE_MODES.FIXED
        ? 'fee = fixedMmk($min × rate)'
        : mode === FEE_MODES.FIXED_PLUS_PERCENT
          ? 'fee = max(fixed + amount * percent/100, minimum)'
          : 'Math.max(amount * feePercent/100, minimumFee)';

  return {
    amount,
    amount_mmk: amount,
    fee,
    fee_mmk: fee,
    net,
    net_mmk: net,
    fee_percent: feePercent,
    minimum_fee: minimumFee,
    minimum_fee_mmk: minimumFee,
    fixed_fee_mmk: mode === FEE_MODES.FIXED
      ? fee
      : mode === FEE_MODES.FIXED_PLUS_PERCENT
        ? fixedFee
        : minimumFee,
    percent_fee_mmk: percentComponent,
    used_minimum_fee: usedMinimum,
    fee_mode: mode,
    fee_type: mode,
    fee_enabled: mode !== FEE_MODES.OFF && fee > 0,
    fee_rule: feeRule,
    fee_label: buildFeeLabel({
      mode,
      fee,
      feePercent,
      minimumFee,
      fixedFee,
      percentComponent,
      currency: 'MMK',
      usedMinimum,
    }),
    invalid_net: net <= 0,
    mmk_to_usd_rate: parseFloat(settings?.mmk_to_usd_rate) || 4500,
    summary: fee > 0
      ? `Gross ${amount.toLocaleString()} MMK − fee ${fee.toLocaleString()} MMK = net ${net.toLocaleString()} MMK`
      : `Gross ${amount.toLocaleString()} MMK (no service fee) = net ${net.toLocaleString()} MMK`,
  };
}

function assertValidPaymentAmount(breakdown, { kind = 'payment' } = {}) {
  if (!breakdown || breakdown.invalid_net) {
    const err = new Error(
      `${kind} amount too small after service fee — increase the amount`
    );
    err.code = 'PAYMENT_FEE_EXCEEDS_AMOUNT';
    throw err;
  }
  return breakdown;
}

module.exports = {
  DEFAULT_FEE_PERCENT,
  DEFAULT_MINIMUM_FEE_USDT,
  DEFAULT_FEE_MODE,
  FEE_MODES,
  calculatePaymentServiceFee,
  calculateUsdtPaymentFeeBreakdown,
  calculateMmkPaymentFeeBreakdown,
  resolveFeePercent,
  resolveFixedFeeUsdt,
  resolveMinimumFeeUsdt,
  resolveMinimumFeeMmk,
  resolveFeeMode,
  normalizeFeeMode,
  assertValidPaymentAmount,
  roundMoney,
};
