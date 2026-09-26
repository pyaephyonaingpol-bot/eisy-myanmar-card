/**
 * Bitnob provider fee schedule (USD) for virtual cards.
 *
 * Consumer / FAQ pricing (also used for partner pass-through to users):
 *   - Card creation: $2 flat (one-time)
 *   - Funding: $1 flat when load < $100; 1% of load when load >= $100
 *
 * Override via env when Bitnob updates partner commercial terms.
 */

const { roundUsd } = require('./cardIssuanceFees');

const BITNOB_CARD_CREATE_FEE_USD = (() => {
  const n = Number(process.env.BITNOB_CARD_CREATE_FEE_USD);
  return Number.isFinite(n) && n >= 0 ? n : 2;
})();

const BITNOB_FUND_FEE_FLAT_USD = (() => {
  const n = Number(process.env.BITNOB_FUND_FEE_FLAT_USD);
  return Number.isFinite(n) && n >= 0 ? n : 1;
})();

const BITNOB_FUND_FEE_PERCENT = (() => {
  const n = Number(process.env.BITNOB_FUND_FEE_PERCENT);
  return Number.isFinite(n) && n >= 0 ? n : 1;
})();

const BITNOB_FUND_FEE_THRESHOLD_USD = (() => {
  const n = Number(process.env.BITNOB_FUND_FEE_THRESHOLD_USD);
  return Number.isFinite(n) && n > 0 ? n : 100;
})();

/**
 * Bitnob funding / top-up fee for a given load amount (USD).
 * <$100 → flat $1; ≥$100 → 1% of load.
 */
function resolveBitnobFundingFeeUsd(loadUsd) {
  const amount = Number(loadUsd);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount < BITNOB_FUND_FEE_THRESHOLD_USD) {
    return roundUsd(BITNOB_FUND_FEE_FLAT_USD);
  }
  return roundUsd((amount * BITNOB_FUND_FEE_PERCENT) / 100);
}

function getBitnobFeeSchedule() {
  return {
    create_fee_usd: BITNOB_CARD_CREATE_FEE_USD,
    fund_fee_flat_usd: BITNOB_FUND_FEE_FLAT_USD,
    fund_fee_percent: BITNOB_FUND_FEE_PERCENT,
    fund_fee_threshold_usd: BITNOB_FUND_FEE_THRESHOLD_USD,
    fund_fee_rule: `$${BITNOB_FUND_FEE_FLAT_USD.toFixed(2)} if load < $${BITNOB_FUND_FEE_THRESHOLD_USD}; else ${BITNOB_FUND_FEE_PERCENT}%`,
  };
}

module.exports = {
  BITNOB_CARD_CREATE_FEE_USD,
  BITNOB_FUND_FEE_FLAT_USD,
  BITNOB_FUND_FEE_PERCENT,
  BITNOB_FUND_FEE_THRESHOLD_USD,
  resolveBitnobFundingFeeUsd,
  getBitnobFeeSchedule,
};
