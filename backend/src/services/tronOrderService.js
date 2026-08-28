/**
 * Custom TRON USDT (TRC20) payment gateway — Supabase orders + TronGrid verification.
 */
const crypto = require('crypto');
const supabaseLib = require('../lib/supabase');
const { getMasterWalletAddress } = require('./tronMasterWalletService');

const DEFAULT_MASTER_DEPOSIT_ADDRESS = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';
const USDT_TRC20_CONTRACT = process.env.USDT_TRC20_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRON_FULL_HOST = (
  process.env.TRON_FULL_HOST
  || process.env.TRONGRID_FULL_HOST
  || 'https://api.trongrid.io'
).replace(/\/$/, '');
const TRC20_DECIMALS = 6;
const ORDER_STATUS_PENDING = 'PENDING';
const ORDER_STATUS_COMPLETED = 'COMPLETED';

function tronApiHeaders() {
  const headers = { Accept: 'application/json' };
  const apiKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
}

/**
 * Master wallet users send USDT to. Prefers env overrides, then platform default.
 */
function getGatewayDepositAddress() {
  const explicit = String(
    process.env.TRON_GATEWAY_DEPOSIT_ADDRESS
    || process.env.MASTER_WALLET_ADDRESS
    || ''
  ).trim();
  if (explicit) return explicit;

  try {
    return getMasterWalletAddress();
  } catch {
    return DEFAULT_MASTER_DEPOSIT_ADDRESS;
  }
}

function generateBusinessOrderId() {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TRON${Date.now()}${suffix}`.slice(0, 32);
}

function roundUsdt(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function amountWithinTolerance(actual, expected, tolerance = null) {
  const exp = Number(expected);
  const act = Number(actual);
  if (!Number.isFinite(exp) || !Number.isFinite(act)) return false;
  const tol = tolerance != null
    ? Number(tolerance)
    : Math.max(0.01, exp * 0.005);
  return Math.abs(act - exp) <= tol;
}

function parseTrc20TransferAmount(transfer) {
  const raw = transfer?.value;
  if (raw == null || raw === '') return NaN;
  const decimals = Number(transfer?.token_info?.decimals ?? TRC20_DECIMALS);
  const str = String(raw).trim();
  if (str.includes('.')) return parseFloat(str);
  const big = BigInt(str);
  const divisor = 10n ** BigInt(decimals);
  const whole = Number(big / divisor);
  const frac = Number(big % divisor) / Number(divisor);
  return roundUsdt(whole + frac);
}

function normalizeTronAddress(addr) {
  return String(addr || '').trim();
}

function mapOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    amount: Number(row.amount),
    deposit_address: row.deposit_address,
    status: row.status,
    created_at: row.created_at,
  };
}

function assertSupabaseConfigured() {
  if (!supabaseLib.isSupabaseEnabled()) {
    const err = new Error('Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  const sb = supabaseLib.getSupabase();
  if (!sb) {
    const err = new Error('Supabase client failed to initialize');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  return sb;
}

/**
 * Create a TRON gateway order in Supabase and return details for the frontend.
 */
async function createTronOrder({ amount_usdt, amount } = {}) {
  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    const err = new Error('Positive amount_usdt is required');
    err.code = 'TRON_ORDER_INVALID_AMOUNT';
    throw err;
  }

  const sb = assertSupabaseConfigured();
  const depositAddress = getGatewayDepositAddress();
  const orderId = generateBusinessOrderId();
  const normalizedAmount = roundUsdt(gross);

  const row = {
    order_id: orderId,
    amount: normalizedAmount,
    deposit_address: depositAddress,
    status: ORDER_STATUS_PENDING,
  };

  const { data, error } = await sb
    .from('orders')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    console.error('[tron/orders] Supabase insert failed:', error.message);
    const err = new Error(`Failed to create order: ${error.message}`);
    err.code = 'TRON_ORDER_INSERT_FAILED';
    throw err;
  }

  return {
    message: 'TRON USDT deposit order created',
    provider: 'tron_trc20',
    order: mapOrderRow(data),
    payment: {
      network: 'TRC20',
      token: 'USDT',
      contract_address: USDT_TRC20_CONTRACT,
      deposit_address: depositAddress,
      amount_usdt: normalizedAmount,
    },
  };
}

async function findTronOrderByOrderId(orderId) {
  const sb = supabaseLib.getSupabase();
  if (!sb || !orderId) return null;

  const { data, error } = await sb
    .from('orders')
    .select('*')
    .eq('order_id', String(orderId))
    .maybeSingle();

  if (error) {
    console.error('[tron/orders] lookup failed:', error.message);
    throw new Error(`Order lookup failed: ${error.message}`);
  }
  return mapOrderRow(data);
}

async function fetchIncomingUsdtTransfers({
  address,
  minTimestampMs = 0,
  limit = 200,
} = {}) {
  const params = new URLSearchParams({
    only_to: 'true',
    only_confirmed: 'true',
    contract_address: USDT_TRC20_CONTRACT,
    limit: String(Math.min(Math.max(Number(limit) || 200, 1), 200)),
    order_by: 'block_timestamp,asc',
  });
  if (minTimestampMs > 0) {
    params.set('min_timestamp', String(Math.floor(minTimestampMs)));
  }

  const url = `${TRON_FULL_HOST}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: tronApiHeaders(),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.Error || payload?.error || `TronGrid HTTP ${response.status}`;
      const err = new Error(message);
      err.code = 'TRONGRID_HTTP_ERROR';
      err.status = response.status;
      throw err;
    }
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.filter((row) => String(row?.type || '').toLowerCase() === 'transfer');
  } catch (err) {
    if (err.name === 'AbortError') {
      const timed = new Error('TronGrid request timed out');
      timed.code = 'TRONGRID_TIMEOUT';
      throw timed;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function listPendingTronOrders() {
  const sb = supabaseLib.getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('orders')
    .select('*')
    .eq('status', ORDER_STATUS_PENDING)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[tron/orders] pending list failed:', error.message);
    throw new Error(`Pending order query failed: ${error.message}`);
  }
  return (data || []).map(mapOrderRow);
}

/**
 * Poll TronGrid for inbound USDT transfers and mark matching orders COMPLETED.
 */
async function verifyPendingTronOrders() {
  if (!supabaseLib.isSupabaseEnabled()) {
    return {
      ok: true,
      skipped: true,
      reason: 'supabase_disabled',
      checked: 0,
      completed: 0,
    };
  }

  const sb = assertSupabaseConfigured();
  const depositAddress = normalizeTronAddress(getGatewayDepositAddress());
  const pending = await listPendingTronOrders();

  if (!pending.length) {
    return {
      ok: true,
      checked: 0,
      completed: 0,
      deposit_address: depositAddress,
    };
  }

  const oldestCreatedMs = pending.reduce((min, order) => {
    const ts = new Date(order.created_at).getTime();
    return Number.isFinite(ts) && ts < min ? ts : min;
  }, Date.now());
  const minTimestampMs = Math.max(0, oldestCreatedMs - 60_000);

  const transfers = await fetchIncomingUsdtTransfers({
    address: depositAddress,
    minTimestampMs,
  });

  const usedTransactionIds = new Set();
  let completed = 0;
  const matches = [];

  for (const order of pending) {
    const orderCreatedMs = new Date(order.created_at).getTime();
    const match = transfers.find((transfer) => {
      const txId = String(transfer?.transaction_id || '').trim();
      if (!txId || usedTransactionIds.has(txId)) return false;

      const toAddress = normalizeTronAddress(transfer?.to);
      if (toAddress !== depositAddress) return false;

      const txMs = Number(transfer?.block_timestamp || 0);
      if (Number.isFinite(orderCreatedMs) && txMs > 0 && txMs < orderCreatedMs) {
        return false;
      }

      const amountUsdt = parseTrc20TransferAmount(transfer);
      if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) return false;

      return amountWithinTolerance(amountUsdt, order.amount);
    });

    if (!match) continue;

    const txId = String(match.transaction_id);
    usedTransactionIds.add(txId);

    const { data: updated, error } = await sb
      .from('orders')
      .update({ status: ORDER_STATUS_COMPLETED })
      .eq('id', order.id)
      .eq('status', ORDER_STATUS_PENDING)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[tron/orders] complete update failed:', order.order_id, error.message);
      continue;
    }

    if (updated) {
      completed += 1;
      matches.push({
        order_id: order.order_id,
        amount_usdt: order.amount,
        tx_hash: txId,
        status: ORDER_STATUS_COMPLETED,
      });
      console.log('[tron/orders] completed', order.order_id, 'via', txId);
    }
  }

  return {
    ok: true,
    checked: pending.length,
    completed,
    deposit_address: depositAddress,
    transfers_scanned: transfers.length,
    matches,
  };
}

let pollInFlight = false;

async function runTronOrderPollSafely() {
  if (pollInFlight) return { skipped: true, reason: 'poll_in_flight' };
  pollInFlight = true;
  try {
    return await verifyPendingTronOrders();
  } catch (err) {
    console.error('[tron/orders/poll]', err.message, err.code || '');
    return {
      ok: false,
      error: err.message,
      code: err.code || 'TRON_ORDER_POLL_FAILED',
    };
  } finally {
    pollInFlight = false;
  }
}

function startTronOrderPoller({ intervalMs } = {}) {
  const ms = Math.max(
    10_000,
    parseInt(process.env.TRON_ORDER_POLL_MS || String(intervalMs || 30_000), 10) || 30_000
  );
  if (String(process.env.TRON_ORDER_POLL_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[tron/orders] background poll disabled (TRON_ORDER_POLL_ENABLED=false)');
    return null;
  }

  const timer = setInterval(() => {
    runTronOrderPollSafely().catch((err) => {
      console.error('[tron/orders/poll]', err.message);
    });
  }, ms);
  timer.unref?.();

  runTronOrderPollSafely().catch((err) => {
    console.error('[tron/orders/poll] initial run failed:', err.message);
  });

  console.log(`[tron/orders] TronGrid poll every ${ms}ms`);
  return timer;
}

module.exports = {
  DEFAULT_MASTER_DEPOSIT_ADDRESS,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_COMPLETED,
  getGatewayDepositAddress,
  createTronOrder,
  findTronOrderByOrderId,
  fetchIncomingUsdtTransfers,
  listPendingTronOrders,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
  startTronOrderPoller,
  parseTrc20TransferAmount,
  amountWithinTolerance,
  mapOrderRow,
};
