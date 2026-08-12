/**
 * Withdrawable net profit = total pool − active user liabilities (− reserved outflows).
 *
 * USDT pool  = TRON master wallet on-chain USDT
 * MMK pool   = platform_mmk_cash_float (if set), else liabilities + booked MMK fee revenue
 *
 * Currencies are never mixed.
 */
'use strict';

const { getDb } = require('../db');
const { getSetting } = require('./settingsService');
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

async function fetchUserLiabilities(db) {
  const row = await db.get(`
    SELECT
      COALESCE(SUM(balance_usdt), 0) AS available_usdt,
      COALESCE(SUM(balance_usdt_locked), 0) AS locked_usdt,
      COALESCE(SUM(balance_mmk), 0) AS total_mmk,
      COUNT(*) AS user_count
    FROM users
  `);
  const availableUsdt = roundUsdt(row?.available_usdt);
  const lockedUsdt = roundUsdt(row?.locked_usdt);
  return {
    user_count: Number(row?.user_count) || 0,
    usdt_available: availableUsdt,
    usdt_locked: lockedUsdt,
    usdt_total: roundUsdt(availableUsdt + lockedUsdt),
    mmk_total: roundMmk(row?.total_mmk),
  };
}

async function fetchPendingCryptoNets(db) {
  try {
    const row = await db.get(`
      SELECT
        COALESCE(SUM(net_usdt), 0) AS net_usdt,
        COUNT(*) AS count
      FROM usdt_withdrawal_requests
      WHERE status IN ('pending', 'processing')
        AND LOWER(COALESCE(payout_method, 'crypto')) = 'crypto'
    `);
    return {
      net_usdt: roundUsdt(row?.net_usdt),
      count: Number(row?.count) || 0,
    };
  } catch (_) {
    return { net_usdt: 0, count: 0 };
  }
}

async function fetchPendingMmkNets(db) {
  try {
    const row = await db.get(`
      SELECT
        COALESCE(SUM(net_mmk), 0) AS net_mmk,
        COUNT(*) AS count
      FROM mmk_withdrawal_requests
      WHERE status IN ('pending', 'processing')
    `);
    return {
      net_mmk: roundMmk(row?.net_mmk),
      count: Number(row?.count) || 0,
    };
  } catch (_) {
    return { net_mmk: 0, count: 0 };
  }
}

async function fetchMasterUsdtPool({ skipChain = false } = {}) {
  if (skipChain) {
    return { usdt: null, address: null, skipped: true, error: null };
  }
  try {
    const { getMasterWalletInfo } = require('./tronMasterWalletService');
    const info = await getMasterWalletInfo();
    return {
      usdt: roundUsdt(info.usdtBalance),
      address: info.address,
      skipped: false,
      error: null,
    };
  } catch (err) {
    return {
      usdt: null,
      address: null,
      skipped: false,
      error: err.message || String(err),
      code: err.code || null,
    };
  }
}

/**
 * Optional admin-maintained MMK cash float (bank / payment-account total).
 * Empty / unset → accounting pool (liabilities + booked MMK fees).
 */
async function getMmkCashFloatSetting() {
  const raw = await getSetting('platform_mmk_cash_float');
  if (raw == null || String(raw).trim() === '') {
    return { set: false, amount_mmk: null };
  }
  const amount = roundMmk(raw);
  // 0 or invalid → treat as unset (use accounting pool)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { set: false, amount_mmk: null };
  }
  return { set: true, amount_mmk: amount };
}

/**
 * @param {{ skipChain?: boolean }} [opts]
 */
async function getWithdrawableNetProfit(opts = {}) {
  const db = getDb();
  const liabilities = await fetchUserLiabilities(db);
  const pendingCrypto = await fetchPendingCryptoNets(db);
  const pendingMmk = await fetchPendingMmkNets(db);
  const bookedUsdt = await getPlatformUsdtRevenueBalance();
  const bookedMmk = await getPlatformMmkRevenueBalance();
  const master = await fetchMasterUsdtPool({ skipChain: Boolean(opts.skipChain) });
  const mmkFloat = await getMmkCashFloatSetting();

  // --- USDT ---
  const usdtPool = master.usdt;
  const usdtLiabilities = liabilities.usdt_total;
  const usdtReservedOutflow = pendingCrypto.net_usdt;
  let usdtGrossSurplus = null;
  let usdtWithdrawable = null;
  if (usdtPool != null) {
    usdtGrossSurplus = roundUsdt(usdtPool - usdtLiabilities);
    // Pending crypto nets already left user balances but must still be paid from the pool
    usdtWithdrawable = roundUsdt(usdtPool - usdtLiabilities - usdtReservedOutflow);
  }

  // --- MMK ---
  const mmkLiabilities = liabilities.mmk_total;
  let mmkPool;
  let mmkPoolSource;
  if (mmkFloat.set) {
    mmkPool = mmkFloat.amount_mmk;
    mmkPoolSource = 'platform_mmk_cash_float';
  } else {
    // Accounting identity: fees were taken before/alongside user credits
    mmkPool = roundMmk(mmkLiabilities + bookedMmk);
    mmkPoolSource = 'liabilities_plus_booked_mmk_fees';
  }
  const mmkGrossSurplus = roundMmk(mmkPool - mmkLiabilities);
  // Pending MMK bank payouts are funded from cash float / deposit proceeds, not fee profit.
  // When using cash float, reserve them; when using accounting pool, withdrawable ≈ booked fees.
  const mmkWithdrawable = mmkFloat.set
    ? roundMmk(mmkPool - mmkLiabilities - pendingMmk.net_mmk)
    : roundMmk(bookedMmk);

  return {
    checked_at: new Date().toISOString(),
    formula: {
      usdt: 'master_wallet_usdt − user_usdt_liabilities − pending_crypto_nets',
      mmk_with_cash_float: 'mmk_cash_float − user_mmk_liabilities − pending_mmk_nets',
      mmk_without_cash_float: 'booked_mmk_fee_revenue (pool = liabilities + booked fees)',
    },
    usdt: {
      total_pool_usdt: usdtPool,
      pool_source: 'tron_master_wallet',
      master_wallet_address: master.address,
      master_query_error: master.error,
      master_query_skipped: master.skipped,
      user_liabilities_usdt: usdtLiabilities,
      user_liabilities_breakdown: {
        available_usdt: liabilities.usdt_available,
        locked_usdt: liabilities.usdt_locked,
      },
      reserved_pending_crypto_net_usdt: usdtReservedOutflow,
      pending_crypto_count: pendingCrypto.count,
      gross_surplus_usdt: usdtGrossSurplus,
      withdrawable_net_profit_usdt: usdtWithdrawable,
      booked_fee_profit_usdt: bookedUsdt,
      available: usdtWithdrawable != null,
    },
    mmk: {
      total_pool_mmk: mmkPool,
      pool_source: mmkPoolSource,
      cash_float_configured: mmkFloat.set,
      cash_float_mmk: mmkFloat.set ? mmkFloat.amount_mmk : null,
      user_liabilities_mmk: mmkLiabilities,
      reserved_pending_mmk_net: pendingMmk.net_mmk,
      pending_mmk_withdrawal_count: pendingMmk.count,
      gross_surplus_mmk: mmkGrossSurplus,
      withdrawable_net_profit_mmk: mmkWithdrawable,
      booked_fee_profit_mmk: bookedMmk,
      available: true,
    },
    user_count: liabilities.user_count,
  };
}

module.exports = {
  getWithdrawableNetProfit,
  getMmkCashFloatSetting,
};
