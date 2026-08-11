/**
 * Unified payment service fee for Deposit + Withdrawal.
 * Rule: fee = Math.max(amount * feePercent/100, minimumFee)
 * Default: 2% with minimum $1 USDT (or MMK equivalent of $1).
 */

const DEFAULT_FEE_PERCENT = 2;
const DEFAULT_MINIMUM_FEE_USDT = 1;

function roundMoney(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function resolveFeePercent(settings) {
  const raw = settings?.payment_service_fee_percent;
  const n = raw == null ? DEFAULT_FEE_PERCENT : parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FEE_PERCENT;
}

function resolveMinimumFeeUsdt(settings) {
  const raw = settings?.payment_service_fee_minimum_usdt;
  const n = raw == null ? DEFAULT_MINIMUM_FEE_USDT : parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MINIMUM_FEE_USDT;
}

function resolveMinimumFeeMmk(settings) {
  const rate = parseFloat(settings?.mmk_to_usd_rate) || 4500;
  const minUsdt = resolveMinimumFeeUsdt(settings);
  return Math.round(minUsdt * rate);
}

/**
 * Core formula: Math.max(amount * pct, minimum)
 * @param {number} amount
 * @param {{ feePercent?: number, minimumFee?: number, decimals?: number }} [opts]
 */
function calculatePaymentServiceFee(amount, opts = {}) {
  const amt = Number(amount) || 0;
  if (!(amt > 0)) return 0;

  const feePercent = opts.feePercent != null ? Number(opts.feePercent) : DEFAULT_FEE_PERCENT;
  const minimumFee = opts.minimumFee != null ? Number(opts.minimumFee) : DEFAULT_MINIMUM_FEE_USDT;
  const decimals = opts.decimals != null ? opts.decimals : 2;

  const percentFee = amt * (feePercent / 100);
  const fee = Math.max(percentFee, minimumFee);
  return roundMoney(fee, decimals);
}

/**
 * Full deposit/withdrawal breakdown for USDT (or USD-pegged) amounts.
 */
function calculateUsdtPaymentFeeBreakdown(amountUsdt, settings = {}) {
  const amount = roundMoney(amountUsdt, 2);
  if (!(amount > 0)) {
    throw new Error('Enter a valid amount');
  }

  const feePercent = resolveFeePercent(settings);
  const minimumFee = resolveMinimumFeeUsdt(settings);
  const fee = calculatePaymentServiceFee(amount, { feePercent, minimumFee, decimals: 2 });
  const net = roundMoney(amount - fee, 2);
  const percentComponent = roundMoney(amount * (feePercent / 100), 2);
  const usedMinimum = fee > percentComponent + 0.0001 || (fee === minimumFee && percentComponent < minimumFee);

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
    percent_fee_usdt: percentComponent,
    used_minimum_fee: usedMinimum,
    fee_type: 'percent_with_minimum',
    fee_rule: 'Math.max(amount * feePercent/100, minimumFee)',
    fee_label: usedMinimum
      ? `min $${minimumFee.toFixed(2)} (2% = $${percentComponent.toFixed(2)})`
      : `${feePercent}% ($${fee.toFixed(2)})`,
    invalid_net: net <= 0,
    summary: `Gross $${amount.toFixed(2)} − fee $${fee.toFixed(2)} = net $${net.toFixed(2)}`,
  };
}

/**
 * Full deposit/withdrawal breakdown for MMK amounts.
 * Minimum fee = $1 equivalent at mmk_to_usd_rate.
 */
function calculateMmkPaymentFeeBreakdown(amountMmk, settings = {}) {
  const amount = Math.round(Number(amountMmk) || 0);
  if (!(amount > 0)) {
    throw new Error('Enter a valid MMK amount');
  }

  const feePercent = resolveFeePercent(settings);
  const minimumFee = resolveMinimumFeeMmk(settings);
  const fee = Math.round(calculatePaymentServiceFee(amount, {
    feePercent,
    minimumFee,
    decimals: 0,
  }));
  const net = amount - fee;
  const percentComponent = Math.round(amount * (feePercent / 100));
  const usedMinimum = fee >= minimumFee && percentComponent < minimumFee;

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
    percent_fee_mmk: percentComponent,
    used_minimum_fee: usedMinimum,
    fee_type: 'percent_with_minimum',
    fee_rule: 'Math.max(amount * feePercent/100, minimumFee)',
    fee_label: usedMinimum
      ? `min ${minimumFee.toLocaleString()} MMK (${feePercent}% = ${percentComponent.toLocaleString()} MMK)`
      : `${feePercent}% (${fee.toLocaleString()} MMK)`,
    invalid_net: net <= 0,
    mmk_to_usd_rate: parseFloat(settings?.mmk_to_usd_rate) || 4500,
    summary: `Gross ${amount.toLocaleString()} MMK − fee ${fee.toLocaleString()} MMK = net ${net.toLocaleString()} MMK`,
  };
}

function assertValidPaymentAmount(breakdown, { kind = 'payment' } = {}) {
  if (!breakdown || breakdown.invalid_net) {
    const err = new Error(
      `${kind} amount too small after service fee — increase the amount (fee is max(2%, min $1))`
    );
    err.code = 'PAYMENT_FEE_EXCEEDS_AMOUNT';
    throw err;
  }
  return breakdown;
}

module.exports = {
  DEFAULT_FEE_PERCENT,
  DEFAULT_MINIMUM_FEE_USDT,
  calculatePaymentServiceFee,
  calculateUsdtPaymentFeeBreakdown,
  calculateMmkPaymentFeeBreakdown,
  resolveFeePercent,
  resolveMinimumFeeUsdt,
  resolveMinimumFeeMmk,
  assertValidPaymentAmount,
  roundMoney,
};
