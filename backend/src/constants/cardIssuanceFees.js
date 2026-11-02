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

function nonNegativeUsd(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? roundUsd(n) : fallback;
}

/**
 * Wallet checkout for a new card.
 * total = issuing fee + processing fee + funding % of starting balance + starting balance.
 */
function quoteCardIssuanceCheckout({ initialLoadUsd = 0, settings = {} } = {}) {
  const issuance = nonNegativeUsd(settings.card_issuance_fee_usd, 5);
  const processing = nonNegativeUsd(settings.card_processing_fee_usd, CARD_PROCESSING_FEE_USD);
  const load = roundUsd(Math.max(0, Number(initialLoadUsd) || 0));
  const funding = resolveCardFundingFeeUsd(load, settings);
  const percent = parseFloat(settings.card_funding_fee_percent);
  return {
    card_issuance_fee_usd: issuance,
    card_processing_fee_usd: processing,
    card_funding_fee_percent: Number.isFinite(percent) && percent > 0 ? percent : 0,
    funding_fee_usd: funding,
    initial_load_usd: load,
    total_usd: roundUsd(issuance + processing + funding + load),
  };
}

module.exports = {
  CARD_PROCESSING_FEE_USD,
  resolveCardFundingFeeUsd,
  quoteCardIssuanceCheckout,
  roundUsd,
};
