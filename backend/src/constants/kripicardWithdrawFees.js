/**
 * Kripicard withdrawal markup policy.
 *
 * Total user markup = 4%:
 *   - 3% covers Kripicard network / payout cost
 *   - 1% retained as platform profit margin
 *
 * Payouts are processed within 48 hours (not instant on-chain).
 */
'use strict';

const KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT = 3;
const PLATFORM_WITHDRAW_MARGIN_PERCENT = 1;
const WITHDRAW_MARKUP_PERCENT =
  KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT + PLATFORM_WITHDRAW_MARGIN_PERCENT;
const WITHDRAW_PROCESSING_HOURS = 48;
const WITHDRAW_PAYOUT_PROVIDER = 'kripicard';
const WITHDRAW_FEE_MODE = 'percent';

function roundUsdt(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function splitWithdrawMarkup(amountUsdt, totalFeeUsdt = null) {
  const amount = roundUsdt(amountUsdt);
  const totalFee = totalFeeUsdt != null
    ? roundUsdt(totalFeeUsdt)
    : roundUsdt((amount * WITHDRAW_MARKUP_PERCENT) / 100);
  const networkShare = WITHDRAW_MARKUP_PERCENT > 0
    ? KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT / WITHDRAW_MARKUP_PERCENT
    : 0;
  const networkFee = roundUsdt(totalFee * networkShare);
  const platformFee = roundUsdt(totalFee - networkFee);
  return {
    amount_usdt: amount,
    fee_usdt: totalFee,
    kripicard_network_fee_percent: KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT,
    platform_margin_percent: PLATFORM_WITHDRAW_MARGIN_PERCENT,
    markup_percent: WITHDRAW_MARKUP_PERCENT,
    kripicard_network_fee_usdt: networkFee,
    platform_margin_usdt: platformFee,
    processing_hours: WITHDRAW_PROCESSING_HOURS,
    payout_provider: WITHDRAW_PAYOUT_PROVIDER,
    fee_label: `${WITHDRAW_MARKUP_PERCENT}% ($${totalFee.toFixed(2)} · ${KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT}% Kripicard + ${PLATFORM_WITHDRAW_MARGIN_PERCENT}% platform)`,
    processing_label: `Processed within ${WITHDRAW_PROCESSING_HOURS} hours`,
  };
}

module.exports = {
  KRIPICARD_WITHDRAW_NETWORK_FEE_PERCENT,
  PLATFORM_WITHDRAW_MARGIN_PERCENT,
  WITHDRAW_MARKUP_PERCENT,
  WITHDRAW_PROCESSING_HOURS,
  WITHDRAW_PAYOUT_PROVIDER,
  WITHDRAW_FEE_MODE,
  splitWithdrawMarkup,
  roundUsdt,
};
