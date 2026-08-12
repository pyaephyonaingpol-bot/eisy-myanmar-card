/**
 * Revenue analytics with completely separate MMK and USDT profit ledgers.
 * Native currencies are never mixed into a single primary total.
 */
const { getDb } = require('../db');
const { PLATFORM_FEE_TYPES } = require('../constants/platformFeeTypes');
const PlatformFeeEvent = require('../models/PlatformFeeEvent');
const { getCardPricingSettings } = require('./settingsService');
const {
  getPlatformUsdtRevenueBalance,
  getPlatformMmkRevenueBalance,
  getSubBalance,
} = require('./platformRevenueService');

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function roundMmk(n) {
  return Math.round(Number(n) || 0);
}

function dateKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function isToday(key) {
  return key === new Date().toISOString().slice(0, 10);
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
 * Profit currency for reporting:
 * - Native MMK / USDT events stay in that currency
 * - Legacy USD events follow wallet_type (mmk|usdt); default MMK for card fees
 */
function resolveProfitCurrency(row, meta = {}) {
  const currency = String(row.currency || '').toUpperCase();
  if (currency === 'USDT') return 'USDT';
  if (currency === 'MMK') return 'MMK';

  const wt = String(meta.wallet_type || meta.wallet || meta.paid_from_wallet_type || '').toLowerCase();
  if (wt === 'usdt' || wt === 'usdt_wallet') return 'USDT';
  if (wt === 'mmk' || wt === 'mmk_wallet') return 'MMK';

  if (
    row.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD
    || row.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE
  ) {
    return 'MMK';
  }

  return currency === 'USD' ? 'MMK' : 'USDT';
}

function emptyTotals() {
  return {
    // Native / attributed USDT profit components
    p2p_usdt: 0,
    withdrawal_usdt: 0,
    deposit_usdt: 0,
    card_reload_usdt: 0,
    card_issue_usdt: 0,
    // Native / attributed MMK profit components
    withdrawal_mmk: 0,
    deposit_mmk: 0,
    card_reload_mmk: 0,
    card_issue_mmk: 0,
  };
}

function mapFeeEventToLedgerEntry(row, mmkRate) {
  const meta = PlatformFeeEvent.mapForClient(row)?.metadata || {};
  const currency = String(row.currency || '').toUpperCase();
  const amount = currency === 'MMK' ? roundMmk(row.amount) : round2(row.amount);
  const profitCurrency = resolveProfitCurrency(row, meta);

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

  // Normalize legacy USD amounts into the profit currency bucket
  let amountUsdt = null;
  let amountMmk = null;
  if (currency === 'USDT') {
    amountUsdt = amount;
  } else if (currency === 'MMK') {
    amountMmk = amount;
  } else if (currency === 'USD') {
    if (profitCurrency === 'USDT') {
      amountUsdt = amount;
    } else {
      amountMmk = roundMmk(amount * mmkRate);
    }
  }

  return {
    collected_at: row.collected_at,
    date_key: dateKey(row.collected_at),
    source: FEE_TYPE_LABELS[row.fee_type] || row.fee_type,
    source_key: row.fee_type,
    fee_type: row.fee_type,
    order_ref: orderRef,
    amount_usdt: amountUsdt,
    amount_mmk: amountMmk,
    amount_usd_legacy: currency === 'USD' ? amount : null,
    currency: row.currency,
    profit_currency: profitCurrency,
    profit_wallet: profitCurrency === 'USDT' ? 'usdt' : 'mmk',
    wallet_type: meta.wallet_type || meta.wallet || null,
    status: 'Collected',
    description: row.description,
  };
}

async function fetchFeeLedgerEntries(db, mmkRate) {
  const rows = await db.all(`
    SELECT * FROM platform_fee_events
    ORDER BY collected_at DESC
    LIMIT 1000
  `);
  return rows.map((row) => mapFeeEventToLedgerEntry(row, mmkRate));
}

function accumulateEntry(acc, e) {
  const isUsdt = e.profit_currency === 'USDT';

  if (e.fee_type === PLATFORM_FEE_TYPES.P2P) {
    acc.p2p_usdt += e.amount_usdt || 0;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) {
    if (isUsdt) acc.card_reload_usdt += e.amount_usdt || 0;
    else acc.card_reload_mmk += e.amount_mmk || 0;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) {
    if (isUsdt) acc.card_issue_usdt += e.amount_usdt || 0;
    else acc.card_issue_mmk += e.amount_mmk || 0;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) {
    if (isUsdt) acc.withdrawal_usdt += e.amount_usdt || 0;
    else acc.withdrawal_mmk += e.amount_mmk || 0;
  } else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) {
    if (isUsdt) acc.deposit_usdt += e.amount_usdt || 0;
    else acc.deposit_mmk += e.amount_mmk || 0;
  }
  return acc;
}

function usdtProfitTotal(totals) {
  return round2(
    totals.p2p_usdt
    + totals.withdrawal_usdt
    + totals.deposit_usdt
    + totals.card_reload_usdt
    + totals.card_issue_usdt
  );
}

function mmkProfitTotal(totals) {
  return roundMmk(
    totals.withdrawal_mmk
    + totals.deposit_mmk
    + totals.card_reload_mmk
    + totals.card_issue_mmk
  );
}

function buildDailyBreakdown(entries) {
  const byDate = {};

  for (const e of entries) {
    const key = e.date_key || 'unknown';
    if (!byDate[key]) {
      byDate[key] = {
        date: key,
        p2p_fees_usdt: 0,
        deposit_fees_usdt: 0,
        withdrawal_fees_usdt: 0,
        card_reload_fees_usdt: 0,
        card_issue_fees_usdt: 0,
        deposit_fees_mmk: 0,
        withdrawal_fees_mmk: 0,
        card_reload_fees_mmk: 0,
        card_issue_fees_mmk: 0,
        usdt_profit_usdt: 0,
        mmk_profit_mmk: 0,
        transaction_count: 0,
      };
    }
    const bucket = byDate[key];
    bucket.transaction_count += 1;

    if (e.profit_currency === 'USDT') {
      const amt = e.amount_usdt || 0;
      bucket.usdt_profit_usdt += amt;
      if (e.fee_type === PLATFORM_FEE_TYPES.P2P) bucket.p2p_fees_usdt += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) bucket.deposit_fees_usdt += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) bucket.withdrawal_fees_usdt += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) bucket.card_reload_fees_usdt += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) bucket.card_issue_fees_usdt += amt;
    } else {
      const amt = e.amount_mmk || 0;
      bucket.mmk_profit_mmk += amt;
      if (e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT) bucket.deposit_fees_mmk += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL) bucket.withdrawal_fees_mmk += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD) bucket.card_reload_fees_mmk += amt;
      else if (e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE) bucket.card_issue_fees_mmk += amt;
    }
  }

  const rows = Object.values(byDate)
    .map((r) => ({
      ...r,
      p2p_fees_usdt: round2(r.p2p_fees_usdt),
      deposit_fees_usdt: round2(r.deposit_fees_usdt),
      withdrawal_fees_usdt: round2(r.withdrawal_fees_usdt),
      card_reload_fees_usdt: round2(r.card_reload_fees_usdt),
      card_issue_fees_usdt: round2(r.card_issue_fees_usdt),
      deposit_fees_mmk: roundMmk(r.deposit_fees_mmk),
      withdrawal_fees_mmk: roundMmk(r.withdrawal_fees_mmk),
      card_reload_fees_mmk: roundMmk(r.card_reload_fees_mmk),
      card_issue_fees_mmk: roundMmk(r.card_issue_fees_mmk),
      usdt_profit_usdt: round2(r.usdt_profit_usdt),
      mmk_profit_mmk: roundMmk(r.mmk_profit_mmk),
      // Backward-compatible aliases used by older UI bits
      usdt_wallet_net_usdt: round2(r.usdt_profit_usdt),
      mmk_wallet_net_mmk: roundMmk(r.mmk_profit_mmk),
      card_reload_fees_usd: round2(r.card_reload_fees_usdt),
      card_issue_fees_usd: round2(r.card_issue_fees_usdt),
      label: isToday(r.date) ? 'Today' : isYesterday(r.date) ? 'Yesterday' : r.date,
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

function amountDisplay(e) {
  if (e.profit_currency === 'USDT') {
    return `${(e.amount_usdt || 0).toFixed(2)} USDT`;
  }
  return `${Math.round(e.amount_mmk || 0).toLocaleString()} MMK`;
}

function periodCurrencyTotals(rows) {
  return {
    usdt: round2(rows.reduce((s, r) => s + (r.usdt_profit_usdt || 0), 0)),
    mmk: roundMmk(rows.reduce((s, r) => s + (r.mmk_profit_mmk || 0), 0)),
  };
}

async function getRevenueDashboard() {
  const db = getDb();
  const settings = await getCardPricingSettings();
  const mmkRate = settings.mmk_to_usd_rate || 4500;
  const platformUsdtBalance = await getPlatformUsdtRevenueBalance();
  const platformMmkBalance = await getPlatformMmkRevenueBalance();

  const ledger = await fetchFeeLedgerEntries(db, mmkRate);
  const todayKey = new Date().toISOString().slice(0, 10);

  const todayTotals = sumByType(ledger, (e) => e.date_key === todayKey);
  const allTimeTotals = sumByType(ledger);
  const daily = buildDailyBreakdown(ledger);

  const todayUsdt = usdtProfitTotal(todayTotals);
  const allTimeUsdt = usdtProfitTotal(allTimeTotals);
  const todayMmk = mmkProfitTotal(todayTotals);
  const allTimeMmk = mmkProfitTotal(allTimeTotals);

  const auditLog = ledger.slice(0, 200).map((e) => ({
    collected_at: e.collected_at,
    source: e.source,
    fee_type: e.fee_type,
    order_ref: e.order_ref,
    profit_currency: e.profit_currency,
    profit_wallet: e.profit_wallet,
    wallet_type: e.wallet_type,
    amount_display: amountDisplay(e),
    amount_usdt: e.amount_usdt,
    amount_mmk: e.amount_mmk,
    currency: e.currency,
    status: e.status,
  }));

  const subBalances = {
    p2p_usdt: await getSubBalance(PLATFORM_FEE_TYPES.P2P, 'USDT'),
    withdrawal_usdt: await getSubBalance(PLATFORM_FEE_TYPES.WITHDRAWAL, 'USDT'),
    withdrawal_mmk: await getSubBalance(PLATFORM_FEE_TYPES.WITHDRAWAL, 'MMK'),
    deposit_usdt: await getSubBalance(PLATFORM_FEE_TYPES.DEPOSIT, 'USDT'),
    deposit_mmk: await getSubBalance(PLATFORM_FEE_TYPES.DEPOSIT, 'MMK'),
    card_reload_usdt: await getSubBalance(PLATFORM_FEE_TYPES.CARD_RELOAD, 'USDT'),
    card_reload_mmk: await getSubBalance(PLATFORM_FEE_TYPES.CARD_RELOAD, 'MMK'),
    card_issue_usdt: await getSubBalance(PLATFORM_FEE_TYPES.CARD_ISSUE, 'USDT'),
    card_issue_mmk: await getSubBalance(PLATFORM_FEE_TYPES.CARD_ISSUE, 'MMK'),
  };

  const periodToday = periodCurrencyTotals(daily.periods.today);
  const periodYesterday = periodCurrencyTotals(daily.periods.yesterday);
  const period7 = periodCurrencyTotals(daily.periods.last_7_days);
  const periodMonth = periodCurrencyTotals(daily.periods.this_month);

  return {
    summary: {
      // Primary separated profits
      today_usdt_profit_usdt: todayUsdt,
      today_mmk_profit_mmk: todayMmk,
      all_time_usdt_profit_usdt: allTimeUsdt,
      all_time_mmk_profit_mmk: allTimeMmk,

      // Component breakdowns — USDT
      today_p2p_profit_usdt: round2(todayTotals.p2p_usdt),
      today_withdrawal_profit_usdt: round2(todayTotals.withdrawal_usdt),
      today_deposit_profit_usdt: round2(todayTotals.deposit_usdt),
      today_card_reload_profit_usdt: round2(todayTotals.card_reload_usdt),
      today_card_issue_profit_usdt: round2(todayTotals.card_issue_usdt),
      all_time_p2p_profit_usdt: round2(allTimeTotals.p2p_usdt),
      all_time_withdrawal_profit_usdt: round2(allTimeTotals.withdrawal_usdt),
      all_time_deposit_profit_usdt: round2(allTimeTotals.deposit_usdt),
      all_time_card_reload_profit_usdt: round2(allTimeTotals.card_reload_usdt),
      all_time_card_issue_profit_usdt: round2(allTimeTotals.card_issue_usdt),

      // Component breakdowns — MMK
      today_withdrawal_profit_mmk: roundMmk(todayTotals.withdrawal_mmk),
      today_deposit_profit_mmk: roundMmk(todayTotals.deposit_mmk),
      today_card_reload_profit_mmk: roundMmk(todayTotals.card_reload_mmk),
      today_card_issue_profit_mmk: roundMmk(todayTotals.card_issue_mmk),
      all_time_withdrawal_profit_mmk: roundMmk(allTimeTotals.withdrawal_mmk),
      all_time_deposit_profit_mmk: roundMmk(allTimeTotals.deposit_mmk),
      all_time_card_reload_profit_mmk: roundMmk(allTimeTotals.card_reload_mmk),
      all_time_card_issue_profit_mmk: roundMmk(allTimeTotals.card_issue_mmk),

      platform_usdt_revenue_balance: platformUsdtBalance,
      platform_mmk_revenue_balance: platformMmkBalance,
      sub_balances: subBalances,
      mmk_to_usd_rate: mmkRate,

      // Aliases for prior UI field names
      today_usdt_wallet_net_profit_usdt: todayUsdt,
      today_mmk_wallet_net_profit_mmk: todayMmk,
      all_time_usdt_wallet_net_profit_usdt: allTimeUsdt,
      all_time_mmk_wallet_net_profit_mmk: allTimeMmk,
      today_card_reload_profit_usd_usdt: round2(todayTotals.card_reload_usdt),
      today_card_reload_profit_usd_mmk: round2(todayTotals.card_reload_mmk / mmkRate),
      today_card_reload_profit_usd: round2(
        todayTotals.card_reload_usdt + (todayTotals.card_reload_mmk / mmkRate)
      ),
      all_time_card_reload_profit_usd: round2(
        allTimeTotals.card_reload_usdt + (allTimeTotals.card_reload_mmk / mmkRate)
      ),

      // Legacy combined fields kept but clearly marked (not used by new UI)
      today_net_admin_profit_usd: todayUsdt,
      today_net_admin_profit_mmk: todayMmk,
      all_time_net_admin_profit_usd: allTimeUsdt,
      all_time_net_admin_profit_mmk: allTimeMmk,
      today_profit_usd: todayUsdt,
      today_profit_mmk: todayMmk,
      all_time_profit_usd: allTimeUsdt,
      all_time_profit_mmk: allTimeMmk,
      today_p2p_fees_usdt: round2(todayTotals.p2p_usdt),
      all_time_p2p_usdt: round2(allTimeTotals.p2p_usdt),
    },
    daily_breakdown: daily.by_date.slice(0, 31),
    period_totals: {
      // Separated period totals (primary)
      today_usdt: periodToday.usdt,
      today_mmk: periodToday.mmk,
      yesterday_usdt: periodYesterday.usdt,
      yesterday_mmk: periodYesterday.mmk,
      last_7_days_usdt: period7.usdt,
      last_7_days_mmk: period7.mmk,
      this_month_usdt: periodMonth.usdt,
      this_month_mmk: periodMonth.mmk,
      // Aliases
      today_usdt_wallet: periodToday.usdt,
      today_mmk_wallet_mmk: periodToday.mmk,
    },
    fee_audit_log: auditLog,
    counts: {
      total_fee_events: ledger.length,
      p2p_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.P2P).length,
      card_reload_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_RELOAD).length,
      card_issue_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.CARD_ISSUE).length,
      withdrawal_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.WITHDRAWAL).length,
      deposit_fee_events: ledger.filter((e) => e.fee_type === PLATFORM_FEE_TYPES.DEPOSIT).length,
      mmk_profit_fee_events: ledger.filter((e) => e.profit_currency === 'MMK').length,
      usdt_profit_fee_events: ledger.filter((e) => e.profit_currency === 'USDT').length,
      mmk_wallet_fee_events: ledger.filter((e) => e.profit_currency === 'MMK').length,
      usdt_wallet_fee_events: ledger.filter((e) => e.profit_currency === 'USDT').length,
    },
  };
}

module.exports = {
  getRevenueDashboard,
  resolveProfitCurrency,
  usdtProfitTotal,
  mmkProfitTotal,
  // Back-compat exports
  resolveProfitWallet: (row, meta) => (
    resolveProfitCurrency(row, meta) === 'USDT' ? 'usdt' : 'mmk'
  ),
  usdtWalletNetProfitUsdt: usdtProfitTotal,
  mmkWalletNetProfitMmk: mmkProfitTotal,
};
