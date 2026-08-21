/**
 * Daily CSV export helpers for admin accounting.
 * Primary source: Supabase public.transactions (NOWPayments deposits).
 */
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const TransactionLog = require('../models/TransactionLog');
const {
  listP2pAdminTransactions,
  listCardReloadAdminTransactions,
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
  // Format YYYY-MM-DD in Asia/Yangon without external deps.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA yields YYYY-MM-DD
  return fmt.format(now);
}

function flattenMetadata(meta) {
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  return {
    deposit_id: m.deposit_id ?? '',
    deposit_ref: m.deposit_ref ?? '',
    invoice_id: m.invoice_id ?? '',
    gross_usdt: m.gross_usdt ?? '',
    fee_usdt: m.fee_usdt ?? '',
    net_usdt: m.net_usdt ?? m.amount ?? '',
    provider: m.provider ?? 'nowpayments',
  };
}

async function fetchSupabaseTransactionsForDay(bounds) {
  if (!isSupabaseEnabled()) {
    const err = new Error('Supabase is not configured');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  const sb = getSupabase();
  if (!sb) {
    const err = new Error('Supabase client unavailable');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  // Prefer created_at for "daily" accounting of new deposits.
  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .gte('created_at', bounds.startIso)
    .lte('created_at', bounds.endIso)
    .order('created_at', { ascending: true });

  if (error) {
    const err = new Error(
      /Could not find the table|PGRST205/i.test(error.message || '')
        ? 'Supabase transactions table is missing — run supabase/nowpayments_transactions.sql'
        : `Supabase query failed: ${error.message}`
    );
    err.code = 'SUPABASE_QUERY_FAILED';
    throw err;
  }

  return data || [];
}

function supabaseRowsToCsv(rows) {
  const headers = [
    'created_at',
    'updated_at',
    'id',
    'user_id',
    'payment_id',
    'order_id',
    'amount',
    'currency',
    'status',
    'payment_status',
    'deposit_ref',
    'deposit_id',
    'invoice_id',
    'gross_usdt',
    'fee_usdt',
    'net_usdt',
    'provider',
  ];

  const mapped = rows.map((row) => {
    const flat = flattenMetadata(row.metadata);
    return {
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
      id: row.id || '',
      user_id: row.user_id || '',
      payment_id: row.payment_id || '',
      order_id: row.order_id || '',
      amount: row.amount ?? '',
      currency: row.currency || 'USDT',
      status: row.status || '',
      payment_status: row.payment_status || '',
      deposit_ref: flat.deposit_ref,
      deposit_id: flat.deposit_id,
      invoice_id: flat.invoice_id,
      gross_usdt: flat.gross_usdt,
      fee_usdt: flat.fee_usdt,
      net_usdt: flat.net_usdt,
      provider: flat.provider,
    };
  });

  return toCsv(headers, mapped);
}

function p2pRowsToCsv(rows) {
  const headers = [
    'created_at',
    'released_at',
    'id',
    'ref_code',
    'side',
    'escrow_usdt',
    'platform_fee_usdt',
    'status',
    'buyer_user_id',
    'buyer_name',
    'buyer_email',
    'seller_user_id',
    'seller_name',
    'seller_email',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    released_at: t.released_at || '',
    id: t.id ?? '',
    ref_code: t.ref_code || '',
    side: t.side || '',
    escrow_usdt: t.escrow_usdt ?? '',
    platform_fee_usdt: t.platform_fee_usdt ?? '',
    status: t.status || '',
    buyer_user_id: t.buyer?.user_id ?? '',
    buyer_name: t.buyer?.name || '',
    buyer_email: t.buyer?.email || '',
    seller_user_id: t.seller?.user_id ?? '',
    seller_name: t.seller?.name || '',
    seller_email: t.seller?.email || '',
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

function ledgerRowsToCsv(rows) {
  const headers = [
    'created_at',
    'id',
    'user_id',
    'type',
    'direction',
    'amount_usd',
    'amount_mmk',
    'balance_before',
    'balance_after',
    'reference_type',
    'reference_id',
    'description',
    'created_by',
  ];
  const mapped = (rows || []).map((t) => ({
    created_at: t.created_at || '',
    id: t.id ?? '',
    user_id: t.user_id ?? '',
    type: t.type || '',
    direction: t.direction || '',
    amount_usd: t.amount_usd ?? t.amountUsd ?? '',
    amount_mmk: t.amount_mmk ?? t.amountMmk ?? '',
    balance_before: t.balance_before ?? t.balanceBefore ?? '',
    balance_after: t.balance_after ?? t.balanceAfter ?? '',
    reference_type: t.reference_type ?? t.referenceType ?? '',
    reference_id: t.reference_id ?? t.referenceId ?? '',
    description: t.description || '',
    created_by: t.created_by ?? t.createdBy ?? '',
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
  source = 'nowpayments',
  userId = null,
} = {}) {
  const dateStr = date || todayYangonDateString();
  const bounds = dayBoundsYangon(dateStr);
  const src = String(source || 'nowpayments').toLowerCase();

  let csv;
  let rowCount = 0;
  let filenameSource = src;

  if (src === 'nowpayments' || src === 'supabase' || src === 'transactions') {
    const rows = await fetchSupabaseTransactionsForDay(bounds);
    csv = supabaseRowsToCsv(rows);
    rowCount = rows.length;
    filenameSource = 'nowpayments';
  } else if (src === 'p2p') {
    const all = await listP2pAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'released_at', bounds);
    csv = p2pRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'card_reload') {
    const all = await listCardReloadAdminTransactions({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'reviewed_at', bounds);
    csv = cardReloadRowsToCsv(rows);
    rowCount = rows.length;
  } else if (src === 'ledger' || src === 'all') {
    const all = await TransactionLog.listAll({ userId, limit: 5000 });
    const rows = filterRowsByYangonDay(all, 'created_at', bounds);
    csv = ledgerRowsToCsv(rows);
    rowCount = rows.length;
    filenameSource = 'ledger';
  } else {
    const err = new Error('source must be nowpayments, p2p, card_reload, or ledger');
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
