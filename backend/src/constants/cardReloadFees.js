/** Fixed card reload fee structure (USD) */
const CARD_RELOAD_USER_FEE_USD = 3.5;
const CARD_RELOAD_PROVIDER_COST_USD = 1.5;
const CARD_RELOAD_NET_PROFIT_USD = 2.0;

function getCardReloadFeeBreakdown() {
  return {
    reload_fee_usd: CARD_RELOAD_USER_FEE_USD,
    provider_cost_usd: CARD_RELOAD_PROVIDER_COST_USD,
    net_profit_usd: CARD_RELOAD_NET_PROFIT_USD,
  };
}

function resolveReloadNetProfit({ pricing, reload_fee_usd: reloadFeeUsd } = {}) {
  if (pricing?.net_profit_usd != null) {
    return Math.round(Number(pricing.net_profit_usd) * 100) / 100;
  }
  const fee = Number(reloadFeeUsd);
  if (Number.isFinite(fee) && fee > 0) {
    return Math.max(0, Math.round((fee - CARD_RELOAD_PROVIDER_COST_USD) * 100) / 100);
  }
  return CARD_RELOAD_NET_PROFIT_USD;
}

module.exports = {
  CARD_RELOAD_USER_FEE_USD,
  CARD_RELOAD_PROVIDER_COST_USD,
  CARD_RELOAD_NET_PROFIT_USD,
  getCardReloadFeeBreakdown,
  resolveReloadNetProfit,
};
