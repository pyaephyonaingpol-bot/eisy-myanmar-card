/**
 * Shared USDT TRC20 deposit matcher + credit path.
 *
 * Used by:
 *   - In-process / cron poller (TronGrid account scans)
 *   - POST /api/webhook/tron (real-time transfer notifications)
 *
 * Matching rules (same for webhook + poll):
 *   1. Resolve pending Supabase `orders` for the deposit address
 *   2. Require amount within tolerance of the order amount
 *   3. Ignore transfers older than the order create time
 *   4. Credit via depositService.creditDepositAndVerify (idempotent)
 *   5. Mark the order COMPLETED with the tx hash
 */
const supabaseLib = require('../lib/supabase');
const { getDb } = require('../db');
const DepositRequest = require('../models/DepositRequest');
const { creditDepositAndVerify, assertTxHashAvailable } = require('./depositService');
const { formatUsdt } = require('./walletService');

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
  const apiKey = process.env.TRONGRID_API_KEY
    || process.env.TRON_PRO_API_KEY
    || process.env.TRON_API_KEY;
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  return headers;
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
  const raw = transfer?.value ?? transfer?.amount ?? transfer?.quant ?? transfer?.amount_usdt;
  if (raw == null || raw === '') return NaN;
  const decimals = Number(
    transfer?.token_info?.decimals
    ?? transfer?.decimals
    ?? TRC20_DECIMALS
  );
  const str = String(raw).trim();
  if (str.includes('.')) return roundUsdt(parseFloat(str));
  try {
    const big = BigInt(str);
    const divisor = 10n ** BigInt(decimals);
    const whole = Number(big / divisor);
    const frac = Number(big % divisor) / Number(divisor);
    return roundUsdt(whole + frac);
  } catch (_) {
    const n = Number(str);
    return Number.isFinite(n) ? roundUsdt(n) : NaN;
  }
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

async function findDepositByTronOrderId(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;

  const db = getDb();
  return db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.tron_order_id') = ?
       OR json_extract(metadata, '$.order_id') = ?
    ORDER BY id DESC
    LIMIT 1
  `, id, id);
}

async function creditTronOrderWallet(order, txHash, { createdBy = 'tron-indexer' } = {}) {
  const deposit = order.local_deposit_id
    ? await DepositRequest.findById(order.local_deposit_id)
    : await findDepositByTronOrderId(order.order_id);

  if (!deposit) {
    console.error('[tron/credit] local deposit missing for order', order.order_id);
    return { ok: false, reason: 'deposit_not_found' };
  }

  if (order.user_id != null && Number(deposit.user_id) !== Number(order.user_id)) {
    console.error('[tron/credit] user mismatch for order', order.order_id);
    return { ok: false, reason: 'user_mismatch' };
  }

  await assertTxHashAvailable(txHash, deposit.id);

  const result = await creditDepositAndVerify(deposit, {
    txnId: txHash,
    createdBy,
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

async function markOrderCompleted(order, txHash) {
  const sb = assertSupabaseConfigured();
  const { data: updated, error } = await sb
    .from('orders')
    .update({
      status: ORDER_STATUS_COMPLETED,
      tx_hash: txHash,
      credited_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', ORDER_STATUS_PENDING)
    .select('*')
    .maybeSingle();

  if (error) {
    const err = new Error(`Failed to complete order ${order.order_id}: ${error.message}`);
    err.code = 'TRON_ORDER_COMPLETE_FAILED';
    throw err;
  }
  return mapOrderRow(updated);
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
    console.error('[tron/credit] pending list failed:', error.message);
    throw new Error(`Pending order query failed: ${error.message}`);
  }
  return (data || []).map(mapOrderRow);
}

async function listPendingOrdersForAddress(address) {
  const addr = normalizeTronAddress(address);
  if (!addr) return [];
  const sb = supabaseLib.getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('orders')
    .select('*')
    .eq('status', ORDER_STATUS_PENDING)
    .eq('deposit_address', addr)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[tron/credit] pending-by-address failed:', error.message);
    throw new Error(`Pending order query failed: ${error.message}`);
  }
  return (data || []).map(mapOrderRow);
}

function findMatchingOrder(orders, { amountUsdt, blockTimestampMs, usedTransactionIds = new Set() }) {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  for (const order of orders) {
    const orderCreatedMs = new Date(order.created_at).getTime();
    if (
      Number.isFinite(orderCreatedMs)
      && Number(blockTimestampMs) > 0
      && Number(blockTimestampMs) < orderCreatedMs
    ) {
      continue;
    }
    if (!amountWithinTolerance(amount, order.amount)) continue;
    return order;
  }
  return null;
}

/**
 * Credit a single confirmed USDT transfer against the best matching pending order.
 */
async function processUsdtTransferEvent({
  toAddress,
  amountUsdt,
  txHash,
  blockTimestampMs = 0,
  createdBy = 'tron-indexer',
  usedTransactionIds = null,
} = {}) {
  const to = normalizeTronAddress(toAddress);
  const hash = String(txHash || '').trim();
  const amount = Number(amountUsdt);

  if (!to || !hash) {
    return { ok: false, reason: 'invalid_transfer', ignored: true };
  }
  if (usedTransactionIds && usedTransactionIds.has(hash)) {
    return { ok: true, ignored: true, reason: 'tx_already_used_in_batch' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_amount', ignored: true };
  }

  if (!supabaseLib.isSupabaseEnabled()) {
    return { ok: false, reason: 'supabase_disabled', skipped: true };
  }

  const pending = await listPendingOrdersForAddress(to);
  if (!pending.length) {
    return {
      ok: true,
      ignored: true,
      reason: 'no_pending_order',
      deposit_address: to,
      tx_hash: hash,
    };
  }

  const order = findMatchingOrder(pending, {
    amountUsdt: amount,
    blockTimestampMs,
    usedTransactionIds,
  });

  if (!order) {
    return {
      ok: true,
      ignored: true,
      reason: 'no_amount_match',
      deposit_address: to,
      tx_hash: hash,
      pending_orders: pending.map((o) => o.order_id),
    };
  }

  let creditResult;
  try {
    creditResult = await creditTronOrderWallet(order, hash, { createdBy });
  } catch (err) {
    console.error('[tron/credit] wallet credit failed:', order.order_id, err.message);
    return {
      ok: false,
      reason: err.code || 'credit_failed',
      error: err.message,
      order_id: order.order_id,
      tx_hash: hash,
    };
  }

  if (!creditResult.ok) {
    return {
      ok: false,
      reason: creditResult.reason,
      order_id: order.order_id,
      tx_hash: hash,
    };
  }

  if (usedTransactionIds) usedTransactionIds.add(hash);

  let updated;
  try {
    updated = await markOrderCompleted(order, hash);
  } catch (err) {
    console.error('[tron/credit] complete update failed:', order.order_id, err.message);
    // Wallet already credited — surface partial success for poller/webhook idempotency.
    return {
      ok: true,
      credited: Boolean(creditResult.credited),
      alreadyVerified: Boolean(creditResult.alreadyVerified),
      order_complete: false,
      order_id: order.order_id,
      tx_hash: hash,
      net_usdt: creditResult.net_usdt,
      user_id: creditResult.user_id,
      deposit_id: creditResult.deposit_id,
      warning: err.message,
    };
  }

  if (!updated) {
    // Another worker completed the order first — credit path is still idempotent.
    return {
      ok: true,
      ignored: true,
      reason: 'order_already_completed',
      order_id: order.order_id,
      tx_hash: hash,
      credited: Boolean(creditResult.credited),
      alreadyVerified: Boolean(creditResult.alreadyVerified),
      net_usdt: creditResult.net_usdt,
      user_id: creditResult.user_id,
    };
  }

  console.log(
    '[tron/credit] completed',
    order.order_id,
    'addr',
    to,
    'via',
    hash,
    creditResult.credited ? `(credited ${formatUsdt(creditResult.net_usdt || 0)})` : '(already credited)'
  );

  return {
    ok: true,
    completed: true,
    credited: Boolean(creditResult.credited),
    alreadyVerified: Boolean(creditResult.alreadyVerified),
    order_id: order.order_id,
    amount_usdt: order.amount,
    deposit_address: to,
    tx_hash: hash,
    status: ORDER_STATUS_COMPLETED,
    net_usdt: creditResult.net_usdt,
    user_id: creditResult.user_id,
    deposit_id: creditResult.deposit_id,
    balance_usdt: creditResult.balance_usdt,
  };
}

/**
 * Normalize webhook / indexer payloads into transfer events.
 */
function normalizeWebhookTransfers(body) {
  const events = [];
  const push = (raw) => {
    if (!raw || typeof raw !== 'object') return;

    const nested = raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result)
      ? raw.result
      : null;

    const toAddress = normalizeTronAddress(
      raw.to
      || raw.to_address
      || raw.toAddress
      || nested?.to
      || nested?.to_address
    );
    const txHash = String(
      raw.transaction_id
      || raw.tx_hash
      || raw.txHash
      || raw.txid
      || raw.hash
      || raw.transactionHash
      || ''
    ).trim();

    let amountUsdt = NaN;
    if (raw.amount_usdt != null || raw.amountUsdt != null) {
      amountUsdt = roundUsdt(Number(raw.amount_usdt ?? raw.amountUsdt));
    } else {
      amountUsdt = parseTrc20TransferAmount({
        ...raw,
        ...(nested || {}),
        value: raw.value ?? nested?.value ?? nested?.amount ?? raw.amount,
      });
    }

    const blockTimestampMs = Number(
      raw.block_timestamp
      || raw.blockTimestamp
      || raw.timestamp
      || nested?.block_timestamp
      || 0
    );

    const contract = normalizeTronAddress(
      raw.contract_address
      || raw.contractAddress
      || raw.token_info?.address
      || nested?.contract_address
    );

    if (contract && contract !== USDT_TRC20_CONTRACT) {
      // Allow missing contract; reject explicit non-USDT.
      const sym = String(raw.token_info?.symbol || raw.symbol || nested?.symbol || '').toUpperCase();
      if (sym && sym !== 'USDT') return;
      if (!sym) return;
    }

    if (!toAddress || !txHash) return;
    events.push({
      toAddress,
      amountUsdt,
      txHash,
      blockTimestampMs: Number.isFinite(blockTimestampMs) ? blockTimestampMs : 0,
      raw,
    });
  };

  if (!body) return events;
  if (Array.isArray(body)) {
    body.forEach(push);
    return events;
  }
  if (Array.isArray(body.data)) body.data.forEach(push);
  if (Array.isArray(body.transfers)) body.transfers.forEach(push);
  if (Array.isArray(body.events)) body.events.forEach(push);
  if (Array.isArray(body.result)) body.result.forEach(push);
  if (body.transfer) push(body.transfer);
  if (body.event) push(body.event);
  // Single-object payloads (common for simple workers / TronGrid hooks)
  if (body.to || body.to_address || body.transaction_id || body.tx_hash || body.result?.to) {
    push(body);
  }
  return events;
}

async function handleTronDepositWebhook(body, { createdBy = 'tron-indexer' } = {}) {
  const transfers = normalizeWebhookTransfers(body);
  if (!transfers.length) {
    return {
      ok: true,
      ignored: true,
      reason: 'no_transfers',
      processed: 0,
      completed: 0,
      credited: 0,
    };
  }

  const usedTransactionIds = new Set();
  const results = [];
  let completed = 0;
  let credited = 0;

  for (const transfer of transfers) {
    const result = await processUsdtTransferEvent({
      ...transfer,
      createdBy,
      usedTransactionIds,
    });
    results.push(result);
    if (result.completed) completed += 1;
    if (result.credited) credited += 1;
  }

  return {
    ok: true,
    processed: transfers.length,
    completed,
    credited,
    results,
  };
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

/**
 * Poll TronGrid for inbound USDT transfers to each pending order's deposit
 * address and credit matches (shared with webhook).
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

  assertSupabaseConfigured();
  const pending = await listPendingTronOrders();

  if (!pending.length) {
    return {
      ok: true,
      checked: 0,
      completed: 0,
      addresses_watched: 0,
    };
  }

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
      console.error('[tron/credit] TronGrid fetch failed for', depositAddress, err.message);
      addressErrors.push({ address: depositAddress, error: err.message, code: err.code });
      continue;
    }

    transfersScanned += transfers.length;

    for (const transfer of transfers) {
      const txId = String(transfer?.transaction_id || '').trim();
      if (!txId || usedTransactionIds.has(txId)) continue;

      const toAddress = normalizeTronAddress(transfer?.to);
      if (toAddress !== depositAddress) continue;

      const amountUsdt = parseTrc20TransferAmount(transfer);
      const result = await processUsdtTransferEvent({
        toAddress,
        amountUsdt,
        txHash: txId,
        blockTimestampMs: Number(transfer?.block_timestamp || 0),
        createdBy: 'tron-indexer',
        usedTransactionIds,
      });

      if (result.completed) {
        completed += 1;
        if (result.credited) credited += 1;
        matches.push({
          order_id: result.order_id,
          amount_usdt: result.amount_usdt,
          deposit_address: result.deposit_address,
          tx_hash: result.tx_hash,
          status: ORDER_STATUS_COMPLETED,
          wallet_credited: Boolean(result.credited),
          already_verified: Boolean(result.alreadyVerified),
          net_usdt: result.net_usdt,
          user_id: result.user_id,
        });
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
    console.error('[tron/credit/poll]', err.message, err.code || '');
    return {
      ok: false,
      error: err.message,
      code: err.code || 'TRON_ORDER_POLL_FAILED',
    };
  } finally {
    pollInFlight = false;
  }
}

module.exports = {
  USDT_TRC20_CONTRACT,
  ORDER_STATUS_PENDING,
  ORDER_STATUS_COMPLETED,
  amountWithinTolerance,
  parseTrc20TransferAmount,
  normalizeTronAddress,
  mapOrderRow,
  findDepositByTronOrderId,
  creditTronOrderWallet,
  markOrderCompleted,
  listPendingTronOrders,
  listPendingOrdersForAddress,
  findMatchingOrder,
  processUsdtTransferEvent,
  normalizeWebhookTransfers,
  handleTronDepositWebhook,
  fetchIncomingUsdtTransfers,
  verifyPendingTronOrders,
  runTronOrderPollSafely,
};
