/**
 * Custom TRON USDT (TRC20) payment gateway — Supabase orders + TronGrid verification.
 */
const crypto = require('crypto');
const supabaseLib = require('../lib/supabase');
const { getMasterWalletAddress } = require('./tronMasterWalletService');
const { getDb } = require('../db');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { getDepositFeeSettings } = require('./settingsService');
const { creditDepositAndVerify, uniqueRefCode, assertTxHashAvailable } = require('./depositService');
const { formatUsdt } = require('./walletService');

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
    user_id: row.user_id != null ? Number(row.user_id) : null,
    local_deposit_id: row.local_deposit_id != null ? Number(row.local_deposit_id) : null,
    ref_code: row.ref_code || null,
    amount: Number(row.amount),
    deposit_address: row.deposit_address,
    status: row.status,
    tx_hash: row.tx_hash || null,
    credited_at: row.credited_at || null,
    created_at: row.created_at,
  };
}

async function findDepositByTronOrderId(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;

  const db = getDb();
  const byMeta = await db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.tron_order_id') = ?
       OR json_extract(metadata, '$.order_id') = ?
    ORDER BY id DESC
    LIMIT 1
  `, id, id);

  if (byMeta) return byMeta;
  return null;
}

async function creditTronOrderWallet(order, txHash) {
  const deposit = order.local_deposit_id
    ? await DepositRequest.findById(order.local_deposit_id)
    : await findDepositByTronOrderId(order.order_id);

  if (!deposit) {
    console.error('[tron/orders] local deposit missing for order', order.order_id);
    return { ok: false, reason: 'deposit_not_found' };
  }

  if (order.user_id != null && Number(deposit.user_id) !== Number(order.user_id)) {
    console.error('[tron/orders] user mismatch for order', order.order_id);
    return { ok: false, reason: 'user_mismatch' };
  }

  await assertTxHashAvailable(txHash, deposit.id);

  const result = await creditDepositAndVerify(deposit, {
    txnId: txHash,
    createdBy: 'tron-indexer',
    adminNote: `TRON TRC20 auto-verified — order ${order.order_id}`,
  });

  return {
    ok: true,
    credited: !result.alreadyVerified,
    alreadyVerified: Boolean(result.alreadyVerified),
    net_usdt: result.net_usdt,
    user_id: deposit.user_id,
    deposit_id: deposit.id,
    balance_usdt: Number(result.user?.balance_usdt ?? 0),
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
 * Create a TRON gateway order in Supabase and a matching local pending deposit.
 */
async function createTronOrder(userId, { amount_usdt, amount } = {}) {
  if (!userId) {
    const err = new Error('Authenticated user is required');
    err.code = 'TRON_ORDER_USER_REQUIRED';
    throw err;
  }

  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    const err = new Error('Positive amount_usdt is required');
    err.code = 'TRON_ORDER_INVALID_AMOUNT';
    throw err;
  }

  const settings = await getDepositFeeSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (gross < minUsdt) {
    const err = new Error(`Minimum TRON deposit is $${Number(minUsdt).toFixed(2)} USDT`);
    err.code = 'TRON_ORDER_AMOUNT_TOO_LOW';
    throw err;
  }

  const feeBreakdown = calculateUsdtPaymentFeeBreakdown(gross, settings);
  assertValidPaymentAmount(feeBreakdown, { kind: 'TRON deposit' });

  const sb = assertSupabaseConfigured();
  const resolvedAddress = await (async () => {
    const { resolveUserTrc20DepositAddress } = require('./tronDepositAddressService');
    return resolveUserTrc20DepositAddress(userId, getGatewayDepositAddress);
  })();
  const depositAddress = resolvedAddress.address;
  const orderId = generateBusinessOrderId();
  const refCode = await uniqueRefCode();
  const normalizedAmount = roundUsdt(gross);

  const metadata = {
    deposit_currency: 'USDT',
    deposit_channel: 'tron_trc20',
    payment_provider: 'tron_trc20',
    tron_order_id: orderId,
    order_id: orderId,
    usdt_network: 'TRC20',
    deposit_address: depositAddress,
    deposit_address_source: resolvedAddress.source,
    derivation_index: resolvedAddress.index,
    derivation_path: resolvedAddress.path,
    amount_usdt: feeBreakdown.amount_usdt,
    gross_usdt: feeBreakdown.amount_usdt,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'tron_trc20',
      gross_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      platform_profit_usd: feeBreakdown.fee_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_rule: feeBreakdown.fee_rule,
      fee_label: feeBreakdown.fee_label,
    },
    pricing: {
      amount_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      platform_profit_usd: feeBreakdown.fee_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_label: feeBreakdown.fee_label,
      is_usdt_topup: true,
      deposit_channel: 'tron_trc20',
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: feeBreakdown.amount_usdt,
    refCode,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata,
    platformProfitUsd: feeBreakdown.fee_usdt,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: feeBreakdown.amount_usdt,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] TRON deposit ${refCode} — gross ${formatUsdt(feeBreakdown.amount_usdt)}, fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'tron_trc20',
      tron_order_id: orderId,
      payment_fee: metadata.payment_fee,
    },
  }).catch((err) => {
    console.warn('[tron/orders] deposit_request log skipped:', err.message);
  });

  const row = {
    order_id: orderId,
    user_id: userId,
    local_deposit_id: deposit.id,
    ref_code: refCode,
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
    deposit: {
      id: deposit.id,
      ref_code: refCode,
      status: deposit.status,
    },
    fee_breakdown: feeBreakdown,
    payment: {
      network: 'TRC20',
      token: 'USDT',
      contract_address: USDT_TRC20_CONTRACT,
      deposit_address: depositAddress,
      deposit_address_source: resolvedAddress.source,
      derivation_index: resolvedAddress.index,
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
 * Poll TronGrid for inbound USDT transfers to each pending order's deposit
 * address (per-user HD addresses) and mark matching orders COMPLETED.
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
  const pending = await listPendingTronOrders();

  if (!pending.length) {
    return {
      ok: true,
      checked: 0,
      completed: 0,
      addresses_watched: 0,
    };
  }

  // Group pending orders by their unique deposit address.
  const ordersByAddress = new Map();
  for (const order of pending) {
    const addr = normalizeTronAddress(order.deposit_address);
    if (!addr) continue;
    if (!ordersByAddress.has(addr)) ordersByAddress.set(addr, []);
    ordersByAddress.get(addr).push(order);
  }

  const usedTransactionIds = new Set();
  let completed = 0;
  let credited = 0;
  let transfersScanned = 0;
  const matches = [];
  const addressErrors = [];

  for (const [depositAddress, orders] of ordersByAddress.entries()) {
    const oldestCreatedMs = orders.reduce((min, order) => {
      const ts = new Date(order.created_at).getTime();
      return Number.isFinite(ts) && ts < min ? ts : min;
    }, Date.now());
    const minTimestampMs = Math.max(0, oldestCreatedMs - 60_000);

    let transfers;
    try {
      transfers = await fetchIncomingUsdtTransfers({
        address: depositAddress,
        minTimestampMs,
      });
    } catch (err) {
      console.error('[tron/orders] TronGrid fetch failed for', depositAddress, err.message);
      addressErrors.push({ address: depositAddress, error: err.message, code: err.code });
      continue;
    }

    transfersScanned += transfers.length;

    for (const order of orders) {
      const orderCreatedMs = new Date(order.created_at).getTime();
      const orderAddress = normalizeTronAddress(order.deposit_address);
      const match = transfers.find((transfer) => {
        const txId = String(transfer?.transaction_id || '').trim();
        if (!txId || usedTransactionIds.has(txId)) return false;

        const toAddress = normalizeTronAddress(transfer?.to);
        if (toAddress !== orderAddress) return false;

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

      let creditResult;
      try {
        creditResult = await creditTronOrderWallet(order, txId);
      } catch (err) {
        console.error('[tron/orders] wallet credit failed:', order.order_id, err.message);
        continue;
      }

      if (!creditResult.ok) {
        console.error('[tron/orders] wallet credit skipped:', order.order_id, creditResult.reason);
        continue;
      }

      const { data: updated, error } = await sb
        .from('orders')
        .update({
          status: ORDER_STATUS_COMPLETED,
          tx_hash: txId,
          credited_at: new Date().toISOString(),
        })
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
        if (creditResult.credited) credited += 1;
        matches.push({
          order_id: order.order_id,
          amount_usdt: order.amount,
          deposit_address: orderAddress,
          tx_hash: txId,
          status: ORDER_STATUS_COMPLETED,
          wallet_credited: Boolean(creditResult.credited),
          already_verified: Boolean(creditResult.alreadyVerified),
          net_usdt: creditResult.net_usdt,
          user_id: creditResult.user_id,
        });
        console.log(
          '[tron/orders] completed',
          order.order_id,
          'addr',
          orderAddress,
          'via',
          txId,
          creditResult.credited ? `(credited ${formatUsdt(creditResult.net_usdt || 0)})` : '(already credited)'
        );
      }
    }
  }

  return {
    ok: true,
    checked: pending.length,
    completed,
    credited,
    addresses_watched: ordersByAddress.size,
    transfers_scanned: transfersScanned,
    address_errors: addressErrors.length ? addressErrors : undefined,
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
  findDepositByTronOrderId,
  creditTronOrderWallet,
  fetchIncomingUsdtTransfers,
  listPendingTronOrders,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
  startTronOrderPoller,
  parseTrc20TransferAmount,
  amountWithinTolerance,
  mapOrderRow,
};
