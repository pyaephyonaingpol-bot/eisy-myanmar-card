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
  [PLATFORM_FEE_TYPES.DEPOSIT]: 'Deposit Service Fee',
  [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'Card Reload Fee',
  [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'Card Issue Fee',
  [PLATFORM_FEE_TYPES.WITHDRAWAL]: 'Withdrawal Fee',
};

function mapFeeEventToLedgerEntry(row) {
  const meta = PlatformFeeEvent.mapForClient(row)?.metadata || {};
  const isUsdt = row.currency === 'USDT';
  const amount = round2(row.amount);

  let orderRef = `FEE-${row.id}`;
  if (row.reference_type === 'p2p_buy_orders' || row.reference_type === 'p2p_sell_orders') {
    orderRef = meta.ref_code || meta.order_ref || `${row.reference_type}-${row.reference_id}`;
  } else if (row.reference_type === 'card_reload_requests') {
    orderRef = `RELOAD-${row.reference_id}`;
  } else if (row.reference_type === 'cards_v2') {
    orderRef = meta.deposit_ref || `CARD-${row.reference_id}`;
  } else if (row.reference_type === 'usdt_withdrawal_requests') {
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
    amount_usd: isUsdt ? amount : amount,
    amount_mmk: null,
    currency: row.currency,
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

function buildDailyBreakdown(entries, mmkRate) {
  const byDate = {};

  for (const e of entries) {
    const key = e.date_key || 'unknown';
    if (!byDate[key]) {
      byDate[key] = {
        date: key,
        p2p_fees_usdt: 0,
        deposit_fees_usd: 0,
        card_issue_fees_usd: 0,
        card_reload_fees_usd: 0,
        withdrawal_fees_usdt: 0,
        total_usd_equivalent: 0,
        total_mmk_equivalent: 0,
        transaction_count: 0,
      };
    }
    const bucket = byDate[key];
    bucket.transaction_count += 1;

    if (e.fee_type === PLATFORM_FEE_TYPES.P2P) {
      bucket.p2p_fees_usdt += e.amount_usdt || 0;
      bucket.total_usd_equivalent += e.amount_usdt || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) {
      bucket.deposit_fees_usd += e.amount_usd || e.amount_usdt || 0;
      bucket.total_usd_equivalent += e.amount_usd || e.amount_usdt || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) {
      bucket.card_issue_fees_usd += e.amount_usd || 0;
      bucket.total_usd_equivalent += e.amount_usd || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) {
      bucket.card_reload_fees_usd += e.amount_usd || 0;
      bucket.total_usd_equivalent += e.amount_usd || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) {
      bucket.withdrawal_fees_usdt += e.amount_usdt || 0;
      bucket.total_usd_equivalent += e.amount_usdt || 0;
    }
  }

  const rows = Object.values(byDate)
    .map((r) => ({
      ...r,
      p2p_fees_usdt: round2(r.p2p_fees_usdt),
      deposit_fees_usd: round2(r.deposit_fees_usd),
      card_issue_fees_usd: round2(r.card_issue_fees_usd),
      card_reload_fees_usd: round2(r.card_reload_fees_usd),
      withdrawal_fees_usdt: round2(r.withdrawal_fees_usdt),
      total_usd_equivalent: round2(r.total_usd_equivalent),
      total_mmk_equivalent: round2(r.total_usd_equivalent * mmkRate),
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
  return filtered.reduce((acc, e) => {
    if (e.fee_type === PLATFORM_FEE_TYPES.P2P) {
      acc.p2p_usdt += e.amount_usdt || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) {
      acc.deposit_usd += e.amount_usd || e.amount_usdt || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) {
      acc.card_reload_usd += e.amount_usd || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) {
      acc.card_issue_usd += e.amount_usd || 0;
    } else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) {
      acc.withdrawal_usdt += e.amount_usdt || 0;
    }
    return acc;
  }, {
    p2p_usdt: 0,
    deposit_usd: 0,
    card_reload_usd: 0,
    card_issue_usd: 0,
    withdrawal_usdt: 0,
  });
}

function netAdminProfitUsd(totals) {
  return round2(
    totals.p2p_usdt
    + totals.deposit_usd
    + totals.card_reload_usd
    + totals.withdrawal_usdt
  );
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

  const auditLog = ledger.slice(0, 200).map((e) => ({
    collected_at: e.collected_at,
    source: e.source,
    fee_type: e.fee_type,
    order_ref: e.order_ref,
    amount_display: e.currency === 'USDT'
      ? `${(e.amount_usdt || 0).toFixed(2)} USDT`
      : `$${(e.amount_usd || 0).toFixed(2)} USD`,
    amount_usdt: e.amount_usdt,
    amount_usd: e.amount_usd,
    amount_mmk: round2((e.amount_usd || e.amount_usdt || 0) * mmkRate),
    currency: e.currency,
    status: e.status,
  }));

  const subBalances = {
    p2p_usdt: await getSubBalance(PLATFORM_FEE_TYPES.P2P),
    deposit_usdt: await getSubBalance(PLATFORM_FEE_TYPES.DEPOSIT),
    withdrawal_usdt: await getSubBalance(PLATFORM_FEE_TYPES.WITHDRAWAL),
    card_reload_usd: await getSubBalance(PLATFORM_FEE_TYPES.CARD_RELOAD),
    card_issue_usd: await getSubBalance(PLATFORM_FEE_TYPES.CARD_ISSUE),
  };

  return {
    summary: {
      today_p2p_profit_usdt: round2(todayTotals.p2p_usdt),
      today_deposit_profit_usd: round2(todayTotals.deposit_usd),
      today_deposit_profit_usdt: round2(todayTotals.deposit_usd),
      today_card_reload_profit_usd: round2(todayTotals.card_reload_usd),
      today_withdrawal_profit_usdt: round2(todayTotals.withdrawal_usdt),
      today_card_issue_profit_usd: round2(todayTotals.card_issue_usd),
      today_net_admin_profit_usd: netAdminProfitUsd(todayTotals),
      today_net_admin_profit_mmk: round2(netAdminProfitUsd(todayTotals) * mmkRate),

      all_time_p2p_profit_usdt: round2(allTimeTotals.p2p_usdt),
      all_time_deposit_profit_usd: round2(allTimeTotals.deposit_usd),
      all_time_deposit_profit_usdt: round2(allTimeTotals.deposit_usd),
      all_time_card_reload_profit_usd: round2(allTimeTotals.card_reload_usd),
      all_time_withdrawal_profit_usdt: round2(allTimeTotals.withdrawal_usdt),
      all_time_card_issue_profit_usd: round2(allTimeTotals.card_issue_usd),
      all_time_net_admin_profit_usd: netAdminProfitUsd(allTimeTotals),
      all_time_net_admin_profit_mmk: round2(netAdminProfitUsd(allTimeTotals) * mmkRate),

      platform_usdt_revenue_balance: platformUsdtBalance,
      sub_balances: subBalances,
      mmk_to_usd_rate: mmkRate,

      // Legacy fields for backward compatibility
      today_profit_usd: netAdminProfitUsd(todayTotals),
      today_profit_mmk: round2(netAdminProfitUsd(todayTotals) * mmkRate),
      today_p2p_fees_usdt: round2(todayTotals.p2p_usdt),
      today_deposit_fees_usd: round2(todayTotals.deposit_usd),
      today_deposit_fees_usdt: round2(todayTotals.deposit_usd),
      today_card_fees_usd: round2(todayTotals.card_reload_usd + todayTotals.card_issue_usd),
      today_card_fees_mmk: round2((todayTotals.card_reload_usd + todayTotals.card_issue_usd) * mmkRate),
      all_time_profit_usd: netAdminProfitUsd(allTimeTotals),
      all_time_profit_mmk: round2(netAdminProfitUsd(allTimeTotals) * mmkRate),
      all_time_p2p_usdt: round2(allTimeTotals.p2p_usdt),
      all_time_deposit_usd: round2(allTimeTotals.deposit_usd),
      all_time_deposit_usdt: round2(allTimeTotals.deposit_usd),
      all_time_card_fees_usd: round2(allTimeTotals.card_reload_usd + allTimeTotals.card_issue_usd),
    },
    daily_breakdown: daily.by_date.slice(0, 31),
    period_totals: {
      today: round2(daily.periods.today.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      yesterday: round2(daily.periods.yesterday.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      last_7_days: round2(daily.periods.last_7_days.reduce((s, r) => s + r.total_usd_equivalent, 0)),
      this_month: round2(daily.periods.this_month.reduce((s, r) => s + r.total_usd_equivalent, 0)),
    },
    fee_audit_log: auditLog,
    counts: {
      total_fee_events: ledger.length,
      p2p_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.P2P).length,
      deposit_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT).length,
      card_reload_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD).length,
      card_issue_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE).length,
      withdrawal_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL).length,
    },
  };
}

module.exports = {
  getRevenueDashboard,
};
