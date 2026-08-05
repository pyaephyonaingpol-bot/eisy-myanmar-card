const { getDb } = require('../db');
const { getPlatformUsdtRevenueBalance } = require('./platformRevenueService');

function roundUsdt(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundMmk(n) {
  return Math.round(Number(n) || 0);
}

async function getSystemLedgerSummary() {
  const db = getDb();

  const userTotals = await db.get(`
    SELECT
      COALESCE(SUM(balance_usdt), 0) AS available_usdt,
      COALESCE(SUM(balance_mmk), 0) AS total_mmk,
      COUNT(*) AS user_count
    FROM users
  `);

  const adEscrow = await db.get(`
    SELECT COALESCE(SUM(escrow_locked_usdt), 0) AS escrow_usdt
    FROM p2p_ads
    WHERE status IN ('active', 'paused')
      AND escrow_locked_usdt > 0
  `);

  const sellOrderEscrow = await db.get(`
    SELECT COALESCE(SUM(amount_usdt), 0) AS escrow_usdt
    FROM p2p_sell_orders
    WHERE status IN ('pending_merchant_mmk', 'disputed')
  `);

  const pendingWithdrawals = await db.get(`
    SELECT
      COALESCE(SUM(net_usdt), 0) AS pending_net_usdt,
      COALESCE(SUM(fee_usdt), 0) AS pending_fee_usdt,
      COUNT(*) AS pending_count
    FROM usdt_withdrawal_requests
    WHERE status IN ('pending', 'processing')
  `);

  const availableUsdt = roundUsdt(userTotals?.available_usdt);
  const escrowFromAds = roundUsdt(adEscrow?.escrow_usdt);
  const escrowFromSellOrders = roundUsdt(sellOrderEscrow?.escrow_usdt);
  const escrowUsdt = roundUsdt(escrowFromAds + escrowFromSellOrders);
  const totalUsdtLedger = roundUsdt(availableUsdt + escrowUsdt);
  const platformRevenueUsdt = await getPlatformUsdtRevenueBalance();

  return {
    available_usdt: availableUsdt,
    escrow_usdt: escrowUsdt,
    escrow_breakdown: {
      p2p_ads: escrowFromAds,
      p2p_sell_orders: escrowFromSellOrders,
    },
    total_usdt_ledger: totalUsdtLedger,
    total_mmk: roundMmk(userTotals?.total_mmk),
    platform_revenue_usdt: platformRevenueUsdt,
    pending_withdrawals: {
      net_usdt: roundUsdt(pendingWithdrawals?.pending_net_usdt),
      fee_usdt: roundUsdt(pendingWithdrawals?.pending_fee_usdt),
      count: Number(pendingWithdrawals?.pending_count) || 0,
    },
    user_count: Number(userTotals?.user_count) || 0,
  };
}

module.exports = {
  getSystemLedgerSummary,
};
