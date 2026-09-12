/**
 * Card issuance checkout fees.
 * Processing fee is a fixed platform charge; funding fee % comes from admin settings.
 */
const CARD_PROCESSING_FEE_USD = 1.5;

function roundUsd(value) {
  return Math.round(Number(value) * 100) / 100;
}

function resolveCardFundingFeeUsd(initialLoadUsd, settings = {}) {
  const percent = parseFloat(settings.card_funding_fee_percent);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return roundUsd((Number(initialLoadUsd) * percent) / 100);
}

module.exports = {
  CARD_PROCESSING_FEE_USD,
  resolveCardFundingFeeUsd,
  roundUsd,
};
