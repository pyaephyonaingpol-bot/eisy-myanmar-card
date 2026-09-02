/**
 * Daily CSV export helpers for admin accounting.
 * Sources: card issuance, card reloads, MMK withdrawals, USDT deposits, USDT withdrawals.
 */
const TransactionLog = require('../models/TransactionLog');
const {
  listCardIssuanceAdminTransactions,
  listCardReloadAdminTransactions,
  listMmkWithdrawalAdminTransactions,
  listUsdtDepositAdminTransactions,
  listUsdtWithdrawalAdminTransactions,
} = require('./adminLedgerTransactionService');

const YANGON_OFFSET = '+06:30';

function escapeCsvCell(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Calendar day bounds in Asia/Yangon (MMT, UTC+06:30, no DST).
 * @param {string} dateStr YYYY-MM-DD
 */
function dayBoundsYangon(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
    const err = new Error('date must be YYYY-MM-DD');
    err.code = 'INVALID_DATE';
    throw err;
  }
  const start = new Date(`${dateStr}T00:00:00${YANGON_OFFSET}`);
  const end = new Date(`${dateStr}T23:59:59.999${YANGON_OFFSET}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('Invalid date');
    err.code = 'INVALID_DATE';
    throw err;
  }
  return {
    date: dateStr,
    timezone: 'Asia/Yangon',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function todayYangonDateString(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function cardIssuanceRowsToCsv(rows) {
  const headers = [
    'created_at',
    'id',
    'ref_code',
    'user_id',
    'user_name',
    'user_email',
    'card_id',
    'card_last_four',
    'kripicard_cost_usd',
    'platform_markup_usd',
    'total_charge_usdt',
    'wallet_type',
    'provider',
    'provider_card_id',
    'status',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    user_id: t.user_id ?? '',
    user_name: t.user_name || '',
    user_email: t.user_email || '',
    card_id: t.card_id ?? '',
    card_last_four: t.card_last_four || '',
    kripicard_cost_usd: t.kripicard_cost_usd ?? '',
    platform_markup_usd: t.platform_markup_usd ?? '',
    total_charge_usdt: t.total_charge_usdt ?? '',
    wallet_type: t.wallet_type || '',
    provider: t.provider || '',
    provider_card_id: t.provider_card_id || '',
    status: t.status || '',
  }));
  return toCsv(headers, mapped);
}

function cardReloadRowsToCsv(rows) {
  const headers = [
    'created_at',
    'reviewed_at',
    'id',
    'ref_code',
    'user_id',
    'user_name',
    'user_email',
    'reload_amount_usd',
    'fee_profit_usd',
    'wallet_type',
    'status',
    'provider_status',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    reviewed_at: t.reviewed_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    user_id: t.user_id ?? '',
    user_name: t.user_name || '',
    user_email: t.user_email || '',
    reload_amount_usd: t.reload_amount_usd ?? '',
    fee_profit_usd: t.fee_profit_usd ?? '',
    wallet_type: t.wallet_type || '',
    status: t.status || '',
    provider_status: t.provider_status || '',
  }));
  return toCsv(headers, mapped);
}

function mmkWithdrawalRowsToCsv(rows) {
  const headers = [
    'created_at',
    'processed_at',
    'id',
    'ref_code',
    'user_id',
    'user_name',
    'user_email',
    'amount_mmk',
    'fee_mmk',
    'net_mmk',
    'fee_percent',
    'bank_name',
    'account_name',
    'account_number',
    'status',
    'admin_note',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    processed_at: t.processed_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    user_id: t.user_id ?? '',
    user_name: t.user_name || '',
    user_email: t.user_email || '',
    amount_mmk: t.amount_mmk ?? '',
    fee_mmk: t.fee_mmk ?? '',
    net_mmk: t.net_mmk ?? '',
    fee_percent: t.fee_percent ?? '',
    bank_name: t.bank_name || '',
    account_name: t.account_name || '',
    account_number: t.account_number || '',
    status: t.status || '',
    admin_note: t.admin_note || '',
  }));
  return toCsv(headers, mapped);
}

function usdtDepositRowsToCsv(rows) {
  const headers = [
    'created_at',
    'submitted_at',
    'reviewed_at',
    'id',
    'ref_code',
    'user_id',
    'user_name',
    'user_email',
    'amount_usdt',
    'network',
    'deposit_address',
    'tx_hash',
    'tron_order_id',
    'purpose',
    'status',
    'admin_note',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    submitted_at: t.submitted_at || '',
    reviewed_at: t.reviewed_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    user_id: t.user_id ?? '',
    user_name: t.user_name || '',
    user_email: t.user_email || '',
    amount_usdt: t.amount_usdt ?? '',
    network: t.network || '',
    deposit_address: t.deposit_address || '',
    tx_hash: t.tx_hash || '',
    tron_order_id: t.tron_order_id || '',
    purpose: t.purpose || '',
    status: t.status || '',
    admin_note: t.admin_note || '',
  }));
  return toCsv(headers, mapped);
}

function usdtWithdrawalRowsToCsv(rows) {
  const headers = [
    'created_at',
    'processed_at',
    'id',
    'ref_code',
    'user_id',
    'user_name',
    'user_email',
    'payout_method',
    'network',
    'wallet_address',
    'amount_usdt',
    'fee_usdt',
    'net_usdt',
    'tx_hash',
    'status',
    'processed_by',
    'processed_by_name',
    'admin_note',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    processed_at: t.processed_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    user_id: t.user_id ?? '',
    user_name: t.user_name || '',
    user_email: t.user_email || '',
    payout_method: t.payout_method || '',
    network: t.network || '',
    wallet_address: t.wallet_address || '',
    amount_usdt: t.amount_usdt ?? '',
    fee_usdt: t.fee_usdt ?? '',
    net_usdt: t.net_usdt ?? '',
    tx_hash: t.tx_hash || '',
    status: t.status || '',
    processed_by: t.processed_by ?? '',
    processed_by_name: t.processed_by_name || '',
    admin_note: t.admin_note || '',
  }));
  return toCsv(headers, mapped);
}

function filterRowsByYangonDay(rows, dateField, bounds) {
  const startMs = Date.parse(bounds.startIso);
  const endMs = Date.parse(bounds.endIso);
  return (rows || []).filter((row) => {
    const raw = row?.[dateField] || row?.created_at;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });
}

/**
 * Build a daily CSV export.
 * @param {{ date?: string, source?: string, userId?: number|null }} opts
 */
async function buildDailyTransactionsCsv({
  date,
  source = 'card_issuance',
  userId = null,
} = {}) {
  const dateStr = date || todayYangonDateString();
  const bounds = dayBoundsYangon(dateStr);
  const src = String(source || 'card_issuance').toLowerCase();

  let csv;
  let rowCount = 0;
  let filenameSource = src;

  if (src === 'card_issuance') {
    const all = await listCardIssuanceAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'created_at', bounds);
    csv = cardIssuanceRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'card_reload') {
    const all = await listCardReloadAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'reviewed_at', bounds);
    csv = cardReloadRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'mmk_withdrawal') {
    const all = await listMmkWithdrawalAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'processed_at', bounds);
    csv = mmkWithdrawalRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'usdt_deposit') {
    const all = await listUsdtDepositAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'submitted_at', bounds);
    csv = usdtDepositRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'usdt_withdrawal') {
    const all = await listUsdtWithdrawalAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'processed_at', bounds);
    csv = usdtWithdrawalRowsToCsv(rows);
    rowCount = rows.length;
  } else {
    const err = new Error(
      'source must be card_issuance, card_reload, mmk_withdrawal, usdt_deposit, or usdt_withdrawal'
    );
    err.code = 'INVALID_SOURCE';
    throw err;
  }

  const filename = `eisy-${filenameSource}-transactions-${dateStr}.csv`;
  return {
    csv,
    filename,
    rowCount,
    date: dateStr,
    source: filenameSource,
    timezone: bounds.timezone,
    startIso: bounds.startIso,
    endIso: bounds.endIso,
  };
}

module.exports = {
  buildDailyTransactionsCsv,
  dayBoundsYangon,
  todayYangonDateString,
  toCsv,
  escapeCsvCell,
};
