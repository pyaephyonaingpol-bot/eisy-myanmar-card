const { getDb } = require('../db');
const { PLATFORM_FEE_TYPES } = require('../constants/platformFeeTypes');
const PlatformFeeEvent = require('../models/PlatformFeeEvent');
const { getCardPricingSettings, parseRecordMetadata } = require('./settingsService');
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

const EXCLUDED_WITHDRAWAL_STATUSES = new Set(['cancelled', 'rejected', 'failed']);

function emptyNetBucket() {
  return {
    tron_deposit_fees_usd: 0,
    withdrawal_fees_usd: 0,
    card_issue_profit_usd: 0,
    card_topup_markup_usd: 0,
    total_net_usd: 0,
    counts: {
      tron_deposits: 0,
      withdrawals: 0,
      card_issues: 0,
      card_topups: 0,
    },
  };
}

function addNetAmount(buckets, occurredAt, field, amount, countKey) {
  const value = round2(amount);
  if (!(value > 0)) return;
  const key = dateKey(occurredAt);
  const targets = [buckets.all_time];
  if (isToday(key)) targets.push(buckets.today);
  if (isThisMonth(key)) targets.push(buckets.this_month);
  for (const bucket of targets) {
    bucket[field] = round2(bucket[field] + value);
    bucket.counts[countKey] += 1;
  }
}

function finalizeNetBucket(bucket) {
  bucket.total_net_usd = round2(
    bucket.tron_deposit_fees_usd
    + bucket.withdrawal_fees_usd
    + bucket.card_issue_profit_usd
    + bucket.card_topup_markup_usd
  );
  const counts = bucket.counts;
  bucket.transaction_count = counts.tron_deposits
    + counts.withdrawals
    + counts.card_issues
    + counts.card_topups;
  return bucket;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTronDeposit(row) {
  const network = String(row.usdt_network || '').trim().toUpperCase();
  if (network === 'TRC20' || network === 'TRON') return true;
  if (network === 'BEP20' || network === 'ERC20') return false;
  const method = String(row.payment_method || '').toUpperCase();
  if (method.includes('BEP20') || method.includes('ERC20') || method.includes('BSC')) return false;
  if (method.includes('TRC20') || method.includes('TRON')) return true;
  const meta = parseRecordMetadata(row.metadata);
  const channel = String(meta.deposit_channel || meta.usdt_network || meta.network || '').toUpperCase();
  return channel === 'TRC20' || channel === 'TRON';
}

function tronDepositFeeUsd(row) {
  const stored = Number(row.platform_profit_usd);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const meta = parseRecordMetadata(row.metadata);
  return positiveNumber(
    meta.platform_profit_usd
    ?? meta.fee_usdt
    ?? meta.payment_fee?.fee_usdt
    ?? meta.pricing?.fee_usdt
  );
}

function cardIssueProfitUsd(row, providerCost, fallbackIssuance) {
  const meta = parseRecordMetadata(row.metadata);
  const direct = finiteNumber(meta.card_issuance_fee_usd);
  const nested = finiteNumber(meta.pricing?.card_issuance_fee_usd);
  const issuance = direct != null ? direct : (nested != null ? nested : fallbackIssuance);
  return round2(Math.max(0, issuance - providerCost));
}

function markupProfitUsd(fee, explicitCost, defaultCost, explicitNet) {
  const net = finiteNumber(explicitNet);
  if (net != null) return round2(Math.max(0, net));
  const amount = Number(fee);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cost = finiteNumber(explicitCost);
  return round2(Math.max(0, amount - (cost != null ? cost : defaultCost)));
}

function topupDedupeKey(userId, cardId, occurredAt, fee) {
  if (userId == null || cardId == null) return null;
  return `${userId}|${cardId}|${dateKey(occurredAt) || ''}|${round2(fee)}`;
}

/**
 * Net revenue from source transaction rows (not the capped fee-ledger sample).
 * Tron deposit fees, withdrawal fees, card issuing profit, and card top-up markup.
 */
async function getNetRevenueReport() {
  const db = getDb();
  const settings = await getCardPricingSettings();
  const issueProviderCost = round2(
    Number.isFinite(Number(settings.card_issue_provider_cost_usd))
      ? settings.card_issue_provider_cost_usd
      : 1.5
  );
  const reloadProviderCost = round2(
    Number.isFinite(Number(settings.card_reload_provider_cost_usd))
      ? settings.card_reload_provider_cost_usd
      : 1.5
  );
  const issuanceFallback = round2(
    Number.isFinite(Number(settings.card_issuance_fee_usd))
      ? settings.card_issuance_fee_usd
      : 5
  );

  const buckets = {
    today: emptyNetBucket(),
    this_month: emptyNetBucket(),
    all_time: emptyNetBucket(),
  };

  const deposits = await db.all(`
    SELECT platform_profit_usd, metadata, usdt_network, payment_method,
           COALESCE(verified_at, updated_at, created_at) AS occurred_at
    FROM deposit_requests_v2
    WHERE status = 'VERIFIED'
  `);
  for (const row of deposits) {
    if (!isTronDeposit(row)) continue;
    addNetAmount(
      buckets,
      row.occurred_at,
      'tron_deposit_fees_usd',
      tronDepositFeeUsd(row),
      'tron_deposits'
    );
  }

  const withdrawals = await db.all(`
    SELECT fee_usdt, status, created_at AS occurred_at
    FROM usdt_withdrawal_requests
  `);
  for (const row of withdrawals) {
    const status = String(row.status || '').trim().toLowerCase();
    if (EXCLUDED_WITHDRAWAL_STATUSES.has(status)) continue;
    addNetAmount(
      buckets,
      row.occurred_at,
      'withdrawal_fees_usd',
      positiveNumber(row.fee_usdt),
      'withdrawals'
    );
  }

  const issues = await db.all(`
    SELECT amount, metadata, collected_at AS occurred_at
    FROM platform_fee_events
    WHERE fee_type = ?
  `, PLATFORM_FEE_TYPES.CARD_ISSUE);
  for (const row of issues) {
    addNetAmount(
      buckets,
      row.occurred_at,
      'card_issue_profit_usd',
      cardIssueProfitUsd(row, issueProviderCost, issuanceFallback),
      'card_issues'
    );
  }

  const topups = await db.all(`
    SELECT user_id, reference_type, reference_id, metadata, created_at AS occurred_at
    FROM transaction_logs
    WHERE type = 'card_topup'
  `);
  const seenTopups = new Set();
  for (const row of topups) {
    const meta = parseRecordMetadata(row.metadata);
    const fee = finiteNumber(meta.reload_fee_usd ?? meta.pricing?.reload_fee_usd);
    const cardId = row.reference_type === 'cards_v2'
      ? row.reference_id
      : (meta.card_id ?? null);
    const key = topupDedupeKey(row.user_id, cardId, row.occurred_at, fee || 0);
    if (key) seenTopups.add(key);
    addNetAmount(
      buckets,
      row.occurred_at,
      'card_topup_markup_usd',
      markupProfitUsd(
        fee,
        meta.provider_cost_usd ?? meta.pricing?.provider_cost_usd,
        reloadProviderCost,
        meta.net_profit_usd ?? meta.pricing?.net_profit_usd
      ),
      'card_topups'
    );
  }

  const reloads = await db.all(`
    SELECT user_id, card_id, reload_fee_usd, pricing_json, status,
           COALESCE(reviewed_at, updated_at, created_at) AS occurred_at,
           created_at
    FROM card_reload_requests
    WHERE status = 'approved'
  `);
  for (const row of reloads) {
    const pricing = parseRecordMetadata(row.pricing_json);
    const fee = finiteNumber(row.reload_fee_usd ?? pricing.reload_fee_usd) || 0;
    const reviewedKey = topupDedupeKey(row.user_id, row.card_id, row.occurred_at, fee);
    const createdKey = topupDedupeKey(row.user_id, row.card_id, row.created_at, fee);
    if ((reviewedKey && seenTopups.has(reviewedKey)) || (createdKey && seenTopups.has(createdKey))) {
      continue;
    }
    addNetAmount(
      buckets,
      row.occurred_at,
      'card_topup_markup_usd',
      markupProfitUsd(fee, pricing.provider_cost_usd, reloadProviderCost, pricing.net_profit_usd),
      'card_topups'
    );
  }

  const periods = {
    today: finalizeNetBucket(buckets.today),
    this_month: finalizeNetBucket(buckets.this_month),
    all_time: finalizeNetBucket(buckets.all_time),
  };

  const sources = [
    ['tron_deposit_fees_usd', 'Tron deposit fees'],
    ['withdrawal_fees_usd', 'Withdrawal fees'],
    ['card_issue_profit_usd', 'Card issuing profit'],
    ['card_topup_markup_usd', 'Card top-up markup'],
  ];

  return {
    generated_at: new Date().toISOString(),
    currency: 'USD',
    total_net_usd: periods.all_time.total_net_usd,
    formula: {
      tron_deposit_fees: 'Verified TRC20 deposit platform fee',
      withdrawal_fees: 'USDT withdrawal fee, excluding cancelled, rejected, and failed',
      card_issue_profit: 'Issuing fee minus card issue provider cost',
      card_topup_markup: 'Reload fee minus card reload provider cost',
      card_issue_provider_cost_usd: issueProviderCost,
      card_reload_provider_cost_usd: reloadProviderCost,
      card_issuance_fee_fallback_usd: issuanceFallback,
    },
    periods,
    breakdown: sources.map(([key, label]) => ({
      key,
      label,
      today: periods.today[key],
      this_month: periods.this_month[key],
      all_time: periods.all_time[key],
    })),
  };
}

module.exports = {
  getRevenueDashboard,
  getNetRevenueReport,
};
