const { getDb } = require('../db');
const {
  getPlatformUsdtRevenueBalance,
  getPlatformMmkRevenueBalance,
} = require('./platformRevenueService');

function roundUsdt(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundMmk(n) {
  return Math.round(Number(n) || 0);
}

async function getSystemLedgerSummary(options = {}) {
  const skipChain = options.skipChain !== false;
  const db = getDb();

  const userTotals = await db.get(`
    SELECT
      COALESCE(SUM(balance_usdt), 0) AS available_usdt,
      COALESCE(SUM(balance_usdt_locked), 0) AS locked_usdt,
      COALESCE(SUM(balance_mmk), 0) AS total_mmk,
      COUNT(*) AS user_count
    FROM users
  `);

  const escrowHolds = await db.get(`
    SELECT COALESCE(SUM(remaining_usdt), 0) AS escrow_usdt
    FROM usdt_escrow_holds
    WHERE status = 'active' AND remaining_usdt > 0
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
  const lockedUsdt = roundUsdt(userTotals?.locked_usdt);
  const escrowFromHolds = roundUsdt(escrowHolds?.escrow_usdt);
  const totalUsdtLedger = roundUsdt(availableUsdt + lockedUsdt);
  const platformRevenueUsdt = await getPlatformUsdtRevenueBalance();
  const platformRevenueMmk = await getPlatformMmkRevenueBalance();

  let withdrawable = null;
  try {
    const { getWithdrawableNetProfit } = require('./withdrawableProfitService');
    // Settings / ledger summary should load fast; revenue dashboard queries chain separately.
    withdrawable = await getWithdrawableNetProfit({ skipChain });
  } catch (err) {
    console.warn('[ledger-summary] withdrawable profit:', err.message);
  }

  return {
    available_usdt: availableUsdt,
    locked_usdt: lockedUsdt,
    escrow_usdt: lockedUsdt,
    escrow_breakdown: {
      user_locked_balance: lockedUsdt,
      active_escrow_holds: escrowFromHolds,
    },
    total_usdt_ledger: totalUsdtLedger,
    total_mmk: roundMmk(userTotals?.total_mmk),
    platform_revenue_usdt: platformRevenueUsdt,
    platform_revenue_mmk: platformRevenueMmk,
    pending_withdrawals: {
      net_usdt: roundUsdt(pendingWithdrawals?.pending_net_usdt),
      fee_usdt: roundUsdt(pendingWithdrawals?.pending_fee_usdt),
      count: Number(pendingWithdrawals?.pending_count) || 0,
    },
    user_count: Number(userTotals?.user_count) || 0,
    withdrawable_net_profit_usdt: withdrawable?.usdt?.withdrawable_net_profit_usdt ?? null,
    withdrawable_net_profit_mmk: withdrawable?.mmk?.withdrawable_net_profit_mmk ?? null,
    usdt_total_pool_usdt: withdrawable?.usdt?.total_pool_usdt ?? null,
    usdt_user_liabilities_usdt: withdrawable?.usdt?.user_liabilities_usdt ?? null,
    mmk_total_pool_mmk: withdrawable?.mmk?.total_pool_mmk ?? null,
    mmk_user_liabilities_mmk: withdrawable?.mmk?.user_liabilities_mmk ?? null,
    withdrawable: withdrawable || null,
  };
}

module.exports = {
  getSystemLedgerSummary,
};
