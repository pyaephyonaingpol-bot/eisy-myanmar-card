const { getDb } = require('../db');
const { PLATFORM_FEE_TYPES } = require('../constants/platformFeeTypes');
const PlatformFeeEvent = require('../models/PlatformFeeEvent');
const { getCardPricingSettings } = require('./settingsService');
const { getPlatformUsdtRevenueBalance, getSubBalance } = require('./platformRevenueService');

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function dateKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function isToday(key) {
  const today = new Date().toISOString().slice(0, 10);
  return key === today;
}

function isYesterday(key) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return key === d.toISOString().slice(0, 10);
}

function isWithinLast7Days(key) {
  if (!key) return false;
  const d = new Date(`${key}T12:00:00`);
  const now = new Date();
  const diff = (now - d) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff < 7;
}

function isThisMonth(key) {
  if (!key) return false;
  const now = new Date();
  const d = new Date(`${key}T12:00:00`);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

const FEE_TYPE_LABELS = {
  [PLATFORM_FEE_TYPES.P2P]: 'P2P Escrow Fee',
  [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'Card Reload Fee',
  [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'Card Issue Fee',
  [PLATFORM_FEE_TYPES.WITHDRAWAL]: 'Withdrawal Fee',
  [PLATFORM_FEE_TYPES.DEPOSIT]: 'Deposit Fee',
};

/**
 * Attribute a fee event to MMK wallet vs USDT wallet profit.
 * USDT currency → USDT wallet. Explicit wallet_type/wallet metadata wins for USD fees.
 * Card issue / reload without wallet tag default to MMK (primary card payment rail).
 */
function resolveProfitWallet(row, meta = {}) {
  const currency = String(row.currency || '').toUpperCase();
  if (currency === 'USDT') return 'usdt';
  if (currency === 'MMK') return 'mmk';

  const wt = String(meta.wallet_type || meta.wallet || meta.paid_from_wallet_type || '').toLowerCase();
  if (wt === 'usdt' || wt === 'usdt_wallet') return 'usdt';
  if (wt === 'mmk' || wt === 'mmk_wallet') return 'mmk';

  if (
    row.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD
    || row.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE
  ) {
    return 'mmk';
  }

  return currency === 'USD' ? 'mmk' : 'usdt';
}

function emptyTotals() {
  return {
    p2p_usdt: 0,
    card_reload_usd: 0,
    card_reload_usd_mmk: 0,
    card_reload_usd_usdt: 0,
    card_issue_usd: 0,
    card_issue_usd_mmk: 0,
    card_issue_usd_usdt: 0,
    withdrawal_usdt: 0,
    withdrawal_mmk: 0,
    deposit_usdt: 0,
    deposit_mmk: 0,
  };
}

function mapFeeEventToLedgerEntry(row) {
  const meta = PlatformFeeEvent.mapForClient(row)?.metadata || {};
  const currency = String(row.currency || '').toUpperCase();
  const isUsdt = currency === 'USDT';
  const isMmk = currency === 'MMK';
  const amount = round2(row.amount);
  const profitWallet = resolveProfitWallet(row, meta);

  let orderRef = `FEE-${row.id}`;
  if (row.reference_type === 'p2p_buy_orders' || row.reference_type === 'p2p_sell_orders') {
    orderRef = meta.ref_code || meta.order_ref || `${row.reference_type}-${row.reference_id}`;
  } else if (row.reference_type === 'card_reload_requests') {
    orderRef = `RELOAD-${row.reference_id}`;
  } else if (row.reference_type === 'cards_v2') {
    orderRef = meta.deposit_ref || `CARD-${row.reference_id}`;
  } else if (row.reference_type === 'usdt_withdrawal_requests' || row.reference_type === 'mmk_withdrawal_requests') {
    orderRef = meta.ref_code || `WD-${row.reference_id}`;
  } else if (row.reference_type === 'deposit_requests_v2') {
    orderRef = meta.deposit_ref || meta.ref_code || `DEP-${row.reference_id}`;
  }

  return {
    collected_at: row.collected_at,
    date_key: dateKey(row.collected_at),
    source: FEE_TYPE_LABELS[row.fee_type] || row.fee_type,
    source_key: row.fee_type,
    fee_type: row.fee_type,
    order_ref: orderRef,
    amount_usdt: isUsdt ? amount : null,
    amount_usd: isUsdt || isMmk ? null : amount,
    amount_mmk: isMmk ? amount : null,
    currency: row.currency,
    profit_wallet: profitWallet,
    wallet_type: meta.wallet_type || meta.wallet || null,
    status: 'Collected',
    description: row.description,
  };
}

async function fetchFeeLedgerEntries(db) {
  const rows = await db.all(`
    SELECT * FROM platform_fee_events
    ORDER BY collected_at DESC
    LIMIT 1000
  `);
  return rows.map(mapFeeEventToLedgerEntry);
}

function accumulateEntry(acc, e) {
  const wallet = e.profit_wallet === 'usdt' ? 'usdt' : 'mmk';

  if (e.fee_type === PLATFORM_FEE_TYPES.P2P) {
    acc.p2p_usdt += e.amount_usdt || 0;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) {
    const usd = e.amount_usd || 0;
    acc.card_reload_usd += usd;
    if (wallet === 'usdt') acc.card_reload_usd_usdt += usd;
    else acc.card_reload_usd_mmk += usd;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) {
    const usd = e.amount_usd || 0;
    acc.card_issue_usd += usd;
    if (wallet === 'usdt') acc.card_issue_usd_usdt += usd;
    else acc.card_issue_usd_mmk += usd;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) {
    if (e.amount_usdt) acc.withdrawal_usdt += e.amount_usdt;
    if (e.amount_mmk) acc.withdrawal_mmk += e.amount_mmk;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) {
    if (e.amount_usdt) acc.deposit_usdt += e.amount_usdt;
    if (e.amount_mmk) acc.deposit_mmk += e.amount_mmk;
  }
  return acc;
}

function buildDailyBreakdown(entries, mmkRate) {
  const byDate = {};

  for (const e of entries) {
    const key = e.date_key || 'unknown';
    if (!byDate[key]) {
      byDate[key] = {
        date: key,
        p2p_fees_usdt: 0,
        card_issue_fees_usd: 0,
        card_reload_fees_usd: 0,
        card_reload_fees_usd_mmk: 0,
        card_reload_fees_usd_usdt: 0,
        withdrawal_fees_usdt: 0,
        withdrawal_fees_mmk: 0,
        deposit_fees_usdt: 0,
        deposit_fees_mmk: 0,
        usdt_wallet_net_usdt: 0,
        mmk_wallet_net_usd: 0,
        mmk_wallet_net_mmk: 0,
        total_usd_equivalent: 0,
        total_mmk_equivalent: 0,
        transaction_count: 0,
      };
    }
    const bucket = byDate[key];
    bucket.transaction_count += 1;

    const wallet = e.profit_wallet === 'usdt' ? 'usdt' : 'mmk';

    if (e.fee_type === PLATFORM_FEE_TYPES.P2P) {
      const amt = e.amount_usdt || 0;
      bucket.p2p_fees_usdt += amt;
      bucket.usdt_wallet_net_usdt += amt;
      bucket.total_usd_equivalent += amt;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) {
      const amt = e.amount_usd || 0;
      bucket.card_issue_fees_usd += amt;
      if (wallet === 'usdt') bucket.usdt_wallet_net_usdt += amt;
      else {
        bucket.mmk_wallet_net_usd += amt;
        bucket.mmk_wallet_net_mmk += amt * mmkRate;
      }
      bucket.total_usd_equivalent += amt;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) {
      const amt = e.amount_usd || 0;
      bucket.card_reload_fees_usd += amt;
      if (wallet === 'usdt') {
        bucket.card_reload_fees_usd_usdt += amt;
        bucket.usdt_wallet_net_usdt += amt;
      } else {
        bucket.card_reload_fees_usd_mmk += amt;
        bucket.mmk_wallet_net_usd += amt;
        bucket.mmk_wallet_net_mmk += amt * mmkRate;
      }
      bucket.total_usd_equivalent += amt;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) {
      if (e.amount_usdt) {
        bucket.withdrawal_fees_usdt += e.amount_usdt;
        bucket.usdt_wallet_net_usdt += e.amount_usdt;
        bucket.total_usd_equivalent += e.amount_usdt;
      }
      if (e.amount_mmk) {
        bucket.withdrawal_fees_mmk += e.amount_mmk;
        bucket.mmk_wallet_net_mmk += e.amount_mmk;
        bucket.mmk_wallet_net_usd += e.amount_mmk / mmkRate;
        bucket.total_usd_equivalent += e.amount_mmk / mmkRate;
      }
    } else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) {
      if (e.amount_usdt) {
        bucket.deposit_fees_usdt += e.amount_usdt;
        bucket.usdt_wallet_net_usdt += e.amount_usdt;
        bucket.total_usd_equivalent += e.amount_usdt;
      }
      if (e.amount_mmk) {
        bucket.deposit_fees_mmk += e.amount_mmk;
        bucket.mmk_wallet_net_mmk += e.amount_mmk;
        bucket.mmk_wallet_net_usd += e.amount_mmk / mmkRate;
        bucket.total_usd_equivalent += e.amount_mmk / mmkRate;
      }
    }
  }

  const rows = Object.values(byDate)
    .map((r) => ({
      ...r,
      p2p_fees_usdt: round2(r.p2p_fees_usdt),
      card_issue_fees_usd: round2(r.card_issue_fees_usd),
      card_reload_fees_usd: round2(r.card_reload_fees_usd),
      card_reload_fees_usd_mmk: round2(r.card_reload_fees_usd_mmk),
      card_reload_fees_usd_usdt: round2(r.card_reload_fees_usd_usdt),
      withdrawal_fees_usdt: round2(r.withdrawal_fees_usdt),
      withdrawal_fees_mmk: Math.round(r.withdrawal_fees_mmk),
      deposit_fees_usdt: round2(r.deposit_fees_usdt),
      deposit_fees_mmk: Math.round(r.deposit_fees_mmk),
      usdt_wallet_net_usdt: round2(r.usdt_wallet_net_usdt),
      mmk_wallet_net_usd: round2(r.mmk_wallet_net_usd),
      mmk_wallet_net_mmk: Math.round(r.mmk_wallet_net_mmk),
      total_usd_equivalent: round2(r.total_usd_equivalent),
      total_mmk_equivalent: Math.round(r.total_usd_equivalent * mmkRate),
      label: r.date === new Date().toISOString().slice(0, 10) ? 'Today'
        : isYesterday(r.date) ? 'Yesterday' : r.date,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const periods = {
    today: rows.filter((r) => isToday(r.date)),
    yesterday: rows.filter((r) => isYesterday(r.date)),
    last_7_days: rows.filter((r) => isWithinLast7Days(r.date)),
    this_month: rows.filter((r) => isThisMonth(r.date)),
  };

  return { by_date: rows, periods };
}

function sumByType(entries, predicate) {
  const filtered = predicate ? entries.filter(predicate) : entries;
  return filtered.reduce((acc, e) => accumulateEntry(acc, e), emptyTotals());
}

/** Legacy combined net (P2P + all card reload + USDT withdrawal). */
function netAdminProfitUsd(totals) {
  return round2(
    totals.p2p_usdt
    + totals.card_reload_usd
    + totals.withdrawal_usdt
  );
}

function usdtWalletNetProfitUsdt(totals) {
  return round2(
    totals.p2p_usdt
    + totals.withdrawal_usdt
    + totals.deposit_usdt
    + totals.card_reload_usd_usdt
    + totals.card_issue_usd_usdt
  );
}

function mmkWalletNetProfitUsd(totals, mmkRate) {
  const fromUsd = totals.card_reload_usd_mmk + totals.card_issue_usd_mmk;
  const fromMmk = (totals.withdrawal_mmk + totals.deposit_mmk) / (mmkRate || 1);
  return round2(fromUsd + fromMmk);
}

function mmkWalletNetProfitMmk(totals, mmkRate) {
  const fromUsd = (totals.card_reload_usd_mmk + totals.card_issue_usd_mmk) * mmkRate;
  const fromMmk = totals.withdrawal_mmk + totals.deposit_mmk;
  return Math.round(fromUsd + fromMmk);
}

function amountDisplay(e, mmkRate) {
  if (e.currency === 'USDT') {
    return `${(e.amount_usdt || 0).toFixed(2)} USDT`;
  }
  if (e.currency === 'MMK') {
    return `${Math.round(e.amount_mmk || 0).toLocaleString()} MMK`;
  }
  return `$${(e.amount_usd || 0).toFixed(2)} USD`;
}

function amountMmkEquiv(e, mmkRate) {
  if (e.amount_mmk != null) return Math.round(e.amount_mmk);
  return Math.round((e.amount_usd || e.amount_usdt || 0) * mmkRate);
}

async function getRevenueDashboard() {
  const db = getDb();
  const settings = await getCardPricingSettings();
  const mmkRate = settings.mmk_to_usd_rate || 4500;
  const platformUsdtBalance = await getPlatformUsdtRevenueBalance();

  const ledger = await fetchFeeLedgerEntries(db);
  const todayKey = new Date().toISOString().slice(0, 10);

  const todayTotals = sumByType(ledger, (e) => e.date_key === todayKey);
  const allTimeTotals = sumByType(ledger);

  const daily = buildDailyBreakdown(ledger, mmkRate);

  const todayUsdtNet = usdtWalletNetProfitUsdt(todayTotals);
  const allTimeUsdtNet = usdtWalletNetProfitUsdt(allTimeTotals);
  const todayMmkNetUsd = mmkWalletNetProfitUsd(todayTotals, mmkRate);
  const allTimeMmkNetUsd = mmkWalletNetProfitUsd(allTimeTotals, mmkRate);
  const todayMmkNetMmk = mmkWalletNetProfitMmk(todayTotals, mmkRate);
  const allTimeMmkNetMmk = mmkWalletNetProfitMmk(allTimeTotals, mmkRate);

  const auditLog = ledger.slice(0, 200).map((e) => ({
    collected_at: e.collected_at,
    source: e.source,
    fee_type: e.fee_type,
    order_ref: e.order_ref,
    profit_wallet: e.profit_wallet,
    wallet_type: e.wallet_type,
    amount_display: amountDisplay(e, mmkRate),
    amount_usdt: e.amount_usdt,
    amount_usd: e.amount_usd,
    amount_mmk: amountMmkEquiv(e, mmkRate),
    currency: e.currency,
    status: e.status,
  }));

  const subBalances = {
    p2p_usdt: await getSubBalance(PLATFORM_FEE_TYPES.P2P, 'USDT'),
    withdrawal_usdt: await getSubBalance(PLATFORM_FEE_TYPES.WITHDRAWAL, 'USDT'),
    withdrawal_mmk: await getSubBalance(PLATFORM_FEE_TYPES.WITHDRAWAL, 'MMK'),
    deposit_usdt: await getSubBalance(PLATFORM_FEE_TYPES.DEPOSIT, 'USDT'),
    deposit_mmk: await getSubBalance(PLATFORM_FEE_TYPES.DEPOSIT, 'MMK'),
    card_reload_usd: await getSubBalance(PLATFORM_FEE_TYPES.CARD_RELOAD, 'USD'),
    card_issue_usd: await getSubBalance(PLATFORM_FEE_TYPES.CARD_ISSUE, 'USD'),
  };

  return {
    summary: {
      today_p2p_profit_usdt: round2(todayTotals.p2p_usdt),
      today_card_reload_profit_usd: round2(todayTotals.card_reload_usd),
      today_card_reload_profit_usd_mmk: round2(todayTotals.card_reload_usd_mmk),
      today_card_reload_profit_usd_usdt: round2(todayTotals.card_reload_usd_usdt),
      today_withdrawal_profit_usdt: round2(todayTotals.withdrawal_usdt),
      today_withdrawal_profit_mmk: Math.round(todayTotals.withdrawal_mmk),
      today_deposit_profit_usdt: round2(todayTotals.deposit_usdt),
      today_deposit_profit_mmk: Math.round(todayTotals.deposit_mmk),
      today_card_issue_profit_usd: round2(todayTotals.card_issue_usd),
      today_card_issue_profit_usd_mmk: round2(todayTotals.card_issue_usd_mmk),
      today_card_issue_profit_usd_usdt: round2(todayTotals.card_issue_usd_usdt),

      today_usdt_wallet_net_profit_usdt: todayUsdtNet,
      today_usdt_wallet_net_profit_mmk: Math.round(todayUsdtNet * mmkRate),
      today_mmk_wallet_net_profit_usd: todayMmkNetUsd,
      today_mmk_wallet_net_profit_mmk: todayMmkNetMmk,

      today_net_admin_profit_usd: netAdminProfitUsd(todayTotals),
      today_net_admin_profit_mmk: Math.round(netAdminProfitUsd(todayTotals) * mmkRate),

      all_time_p2p_profit_usdt: round2(allTimeTotals.p2p_usdt),
      all_time_card_reload_profit_usd: round2(allTimeTotals.card_reload_usd),
      all_time_card_reload_profit_usd_mmk: round2(allTimeTotals.card_reload_usd_mmk),
      all_time_card_reload_profit_usd_usdt: round2(allTimeTotals.card_reload_usd_usdt),
      all_time_withdrawal_profit_usdt: round2(allTimeTotals.withdrawal_usdt),
      all_time_withdrawal_profit_mmk: Math.round(allTimeTotals.withdrawal_mmk),
      all_time_deposit_profit_usdt: round2(allTimeTotals.deposit_usdt),
      all_time_deposit_profit_mmk: Math.round(allTimeTotals.deposit_mmk),
      all_time_card_issue_profit_usd: round2(allTimeTotals.card_issue_usd),
      all_time_card_issue_profit_usd_mmk: round2(allTimeTotals.card_issue_usd_mmk),
      all_time_card_issue_profit_usd_usdt: round2(allTimeTotals.card_issue_usd_usdt),

      all_time_usdt_wallet_net_profit_usdt: allTimeUsdtNet,
      all_time_usdt_wallet_net_profit_mmk: Math.round(allTimeUsdtNet * mmkRate),
      all_time_mmk_wallet_net_profit_usd: allTimeMmkNetUsd,
      all_time_mmk_wallet_net_profit_mmk: allTimeMmkNetMmk,

      all_time_net_admin_profit_usd: netAdminProfitUsd(allTimeTotals),
      all_time_net_admin_profit_mmk: Math.round(netAdminProfitUsd(allTimeTotals) * mmkRate),

      platform_usdt_revenue_balance: platformUsdtBalance,
      sub_balances: subBalances,
      mmk_to_usd_rate: mmkRate,

      // Legacy fields for backward compatibility
      today_profit_usd: netAdminProfitUsd(todayTotals),
      today_profit_mmk: Math.round(netAdminProfitUsd(todayTotals) * mmkRate),
      today_p2p_fees_usdt: round2(todayTotals.p2p_usdt),
      today_card_fees_usd: round2(todayTotals.card_reload_usd + todayTotals.card_issue_usd),
      today_card_fees_mmk: Math.round((todayTotals.card_reload_usd + todayTotals.card_issue_usd) * mmkRate),
      all_time_profit_usd: netAdminProfitUsd(allTimeTotals),
      all_time_profit_mmk: Math.round(netAdminProfitUsd(allTimeTotals) * mmkRate),
      all_time_p2p_usdt: round2(allTimeTotals.p2p_usdt),
      all_time_card_fees_usd: round2(allTimeTotals.card_reload_usd + allTimeTotals.card_issue_usd),
    },
    daily_breakdown: daily.by_date.slice(0, 31),
    period_totals: {
      today: round2(daily.periods.today.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      yesterday: round2(daily.periods.yesterday.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      last_7_days: round2(daily.periods.last_7_days.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      this_month: round2(daily.periods.this_month.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      today_usdt_wallet: round2(daily.periods.today.reduce((s, r) => s + r.usdt_wallet_net_usdt, 0)),
      today_mmk_wallet_usd: round2(daily.periods.today.reduce((s, r) => s + r.mmk_wallet_net_usd, 0)),
      today_mmk_wallet_mmk: Math.round(daily.periods.today.reduce((s, r) => s + r.mmk_wallet_net_mmk, 0)),
    },
    fee_audit_log: auditLog,
    counts: {
      total_fee_events: ledger.length,
      p2p_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.P2P).length,
      card_reload_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD).length,
      card_issue_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE).length,
      withdrawal_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL).length,
      deposit_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT).length,
      mmk_wallet_fee_events: ledger.filter((e) => e.profit_wallet === 'mmk').length,
      usdt_wallet_fee_events: ledger.filter((e) => e.profit_wallet === 'usdt').length,
    },
  };
}

module.exports = {
  getRevenueDashboard,
  resolveProfitWallet,
  usdtWalletNetProfitUsdt,
  mmkWalletNetProfitUsd,
  mmkWalletNetProfitMmk,
};
