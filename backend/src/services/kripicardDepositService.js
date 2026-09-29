/**
 * Kripicard Deposit API → Master Wallet credit.
 *
 * Replaces legacy HD/shared TRON address + Binance Pay deposit creation:
 *   POST /api/external/deposits/create  → unique pay_address + exact amount
 *   GET  /api/external/deposits/status  → poll until completed
 *   webhook event deposit.completed     → credit users.balance_usdt
 *
 * Env:
 *   KRIPICARD_API_KEY
 *   KRIPICARD_WEBHOOK_SECRET
 *   KRIPICARD_DEPOSIT_POLL_MS (default 30000)
 *   KRIPICARD_DEPOSIT_POLL_ENABLED (default true)
 *   KRIPICARD_DEPOSIT_MIN_USD (optional floor; API enforces ≥ $20)
 */

'use strict';

const crypto = require('crypto');
const { getDb } = require('../db');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const { creditDepositAndVerify, uniqueRefCode } = require('./depositService');
const { formatUsdt } = require('./walletService');
const { enrichDeposit } = require('./depositEnrichment');
const { parseRecordMetadata } = require('./settingsService');
const {
  createDeposit,
  getDepositStatus,
  fetchDepositNetworks,
  normalizeDepositNetwork,
  toLocalUsdtNetwork,
  normalizeDepositRecord,
} = require('../../../lib/kripicard');
const {
  verifyKripicardWebhookSignature,
} = require('./kripicardPaymentCollectionService');

const COMPLETED_STATUSES = new Set([
  'completed',
  'credited',
  'paid',
  'success',
  'succeeded',
  'confirmed',
  'finished',
]);

function generateOrderId(userId) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const uid = String(userId || 0).padStart(4, '0').slice(-6);
  return `KCDEP${Date.now()}${uid}${suffix}`.slice(0, 40);
}

function isCompletedStatus(status) {
  return COMPLETED_STATUSES.has(String(status || '').trim().toLowerCase());
}

function minDepositUsd() {
  const fromEnv = Number(process.env.KRIPICARD_DEPOSIT_MIN_USD);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 20; // live API floor observed 2026-09-29
}

/**
 * Create a Kripicard crypto deposit (unique address + exact amount).
 */
async function createKripicardCryptoDeposit(userId, {
  amount_usdt,
  amount,
  network = 'tron',
  currency = 'USDT',
  order_id = null,
} = {}) {
  if (!userId) {
    const err = new Error('Authenticated user is required');
    err.code = 'KRIPICARD_DEPOSIT_USER_REQUIRED';
    throw err;
  }

  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    const err = new Error('Positive amount_usdt is required');
    err.code = 'KRIPICARD_DEPOSIT_INVALID_AMOUNT';
    throw err;
  }

  const minUsd = minDepositUsd();
  if (gross < minUsd) {
    const err = new Error(`Minimum Kripicard deposit is $${Number(minUsd).toFixed(2)} USDT`);
    err.code = 'KRIPICARD_DEPOSIT_AMOUNT_TOO_LOW';
    throw err;
  }

  const networkId = normalizeDepositNetwork(network);
  const orderId = String(order_id || generateOrderId(userId)).trim();
  const refCode = await uniqueRefCode();

  const provider = await createDeposit({
    amount: gross,
    currency,
    network: networkId,
    orderId,
  });

  const payAmount = Number(provider.pay_amount ?? provider.amount_usd ?? gross);
  const feeUsd = Number(provider.fee_usd || 0) || 0;
  const netUsd = Number(
    provider.credited_on_completion_usd != null
      ? provider.credited_on_completion_usd
      : (payAmount - feeUsd)
  );
  const localNetwork = toLocalUsdtNetwork(provider.network || networkId);

  const metadata = {
    deposit_currency: 'USDT',
    deposit_channel: 'kripicard_deposit',
    payment_provider: 'kripicard',
    ledger: 'master_wallet',
    kripicard_deposit_id: provider.id,
    order_id: orderId,
    kripicard_order_id: orderId,
    usdt_network: localNetwork || String(provider.network || networkId).toUpperCase(),
    kripicard_network: provider.network || networkId,
    deposit_address: provider.pay_address,
    pay_address: provider.pay_address,
    pay_amount: provider.pay_amount,
    pay_currency: provider.pay_currency || 'USDT',
    expires_at: provider.expires_at,
    amount_usdt: payAmount,
    gross_usdt: payAmount,
    fee_usdt: feeUsd,
    net_usdt: netUsd,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'kripicard',
      gross_usdt: payAmount,
      fee_usdt: feeUsd,
      net_usdt: netUsd,
      platform_profit_usd: feeUsd,
      fee_label: feeUsd > 0 ? `$${feeUsd.toFixed(2)} (Kripicard)` : 'included',
      fee_rule: 'kripicard_deposit_fee',
    },
    pricing: {
      amount_usdt: payAmount,
      fee_usdt: feeUsd,
      net_usdt: netUsd,
      platform_profit_usd: feeUsd,
      fee_label: feeUsd > 0 ? `$${feeUsd.toFixed(2)} (Kripicard)` : 'included',
      is_usdt_topup: true,
      deposit_channel: 'kripicard_deposit',
      ledger: 'master_wallet',
    },
    provider_raw: provider.raw || null,
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: payAmount,
    refCode,
    paymentMethod: `KRIPICARD-${String(provider.network || networkId).toUpperCase()}`,
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: localNetwork,
    metadata,
    platformProfitUsd: feeUsd,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: payAmount,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] Kripicard deposit ${refCode} — pay ${formatUsdt(payAmount)} to ${provider.pay_address} (${provider.network}), net ${formatUsdt(netUsd)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'kripicard_deposit',
      ledger: 'master_wallet',
      kripicard_deposit_id: provider.id,
      order_id: orderId,
      payment_fee: metadata.payment_fee,
    },
  }).catch((err) => {
    console.warn('[kripicard/deposit] deposit_request log skipped:', err.message);
  });

  // Persist event row for polling / webhook correlation.
  await recordDepositEvent({
    eventId: `create:${provider.id}`,
    depositId: deposit.id,
    providerDepositId: provider.id,
    orderId,
    userId,
    amountUsdt: payAmount,
    status: provider.status || 'pending',
    raw: provider.raw,
  });

  const order = {
    order_id: orderId,
    id: provider.id,
    kripicard_deposit_id: provider.id,
    user_id: userId,
    local_deposit_id: deposit.id,
    ref_code: refCode,
    amount: payAmount,
    deposit_address: provider.pay_address,
    status: 'PENDING',
    provider_status: provider.status || 'pending',
    network: provider.network || networkId,
    expires_at: provider.expires_at,
    created_at: provider.created_at || new Date().toISOString(),
  };

  return {
    message: `Send exactly ${Number(provider.pay_amount || payAmount).toFixed(2)} ${provider.pay_currency || 'USDT'} on ${String(provider.network || networkId).toUpperCase()} to the address below. Wallet credits $${Number(netUsd).toFixed(2)} after on-chain confirmation.`,
    provider: 'kripicard',
    ledger: 'master_wallet',
    order,
    deposit: enrichDeposit(deposit),
    fee_breakdown: {
      amount_usdt: payAmount,
      fee_usdt: feeUsd,
      net_usdt: netUsd,
      fee_label: metadata.payment_fee.fee_label,
      fee_rule: 'kripicard_deposit_fee',
    },
    payment: {
      network: localNetwork || String(provider.network || networkId).toUpperCase(),
      kripicard_network: provider.network || networkId,
      token: provider.pay_currency || 'USDT',
      deposit_address: provider.pay_address,
      amount_usdt: Number(provider.pay_amount || payAmount),
      pay_amount: provider.pay_amount,
      expires_at: provider.expires_at,
      kripicard_deposit_id: provider.id,
      order_id: orderId,
    },
    kripicard: provider,
  };
}

async function recordDepositEvent({
  eventId,
  depositId,
  providerDepositId,
  orderId,
  userId,
  amountUsdt,
  status,
  raw,
  credited = 0,
} = {}) {
  const db = getDb();
  const eid = String(eventId || '').trim();
  if (!eid) return null;

  const existing = await db.get(
    'SELECT * FROM kripicard_payment_events WHERE event_id = ?',
    eid
  );
  if (existing) return existing;

  await db.run(
    `INSERT INTO kripicard_payment_events (
      event_id, collection_id, payment_id, merchant_reference,
      user_id, deposit_id, amount_usdt, currency, status, raw_payload, credited
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USDT', ?, ?, ?)`,
    eid,
    providerDepositId || null,
    providerDepositId || null,
    orderId || null,
    userId || null,
    depositId || null,
    amountUsdt != null ? Number(amountUsdt) : null,
    status || 'pending',
    raw ? JSON.stringify(raw) : null,
    credited ? 1 : 0
  );
  return db.get('SELECT * FROM kripicard_payment_events WHERE event_id = ?', eid);
}

async function findDepositByKripicardId(providerDepositId) {
  const id = String(providerDepositId || '').trim();
  if (!id) return null;
  const db = getDb();
  return db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.kripicard_deposit_id') = ?
       OR json_extract(metadata, '$.order_id') = ?
       OR json_extract(metadata, '$.kripicard_order_id') = ?
       OR ref_code = ?
    ORDER BY id DESC
    LIMIT 1
  `, id, id, id, id);
}

async function findOrderByOrderId(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;

  const deposit = await findDepositByKripicardId(id);
  if (!deposit) return null;

  const meta = parseRecordMetadata(deposit.metadata);
  const providerId = meta.kripicard_deposit_id || null;
  let providerStatus = null;
  let provider = null;

  if (providerId && deposit.status !== 'VERIFIED') {
    try {
      provider = await getDepositStatus(providerId);
      providerStatus = provider.status;
      if (provider.credited || isCompletedStatus(provider.status)) {
        await creditKripicardDepositIfCompleted(deposit, provider);
        const refreshed = await DepositRequest.findById(deposit.id);
        return mapDepositToOrder(refreshed || deposit, provider);
      }
    } catch (err) {
      console.warn('[kripicard/deposit] status lookup failed:', err.message);
    }
  }

  return mapDepositToOrder(deposit, provider || {
    id: providerId,
    status: deposit.status === 'VERIFIED' ? 'completed' : 'pending',
    network: meta.kripicard_network,
    pay_address: meta.pay_address || meta.deposit_address,
    amount_usd: deposit.amount_usd,
  });
}

function mapDepositToOrder(deposit, provider = null) {
  const meta = parseRecordMetadata(deposit.metadata);
  const verified = String(deposit.status || '').toUpperCase() === 'VERIFIED';
  const completed = verified
    || (provider && (provider.credited || isCompletedStatus(provider.status)));

  return {
    order_id: meta.order_id || meta.kripicard_order_id || meta.kripicard_deposit_id,
    id: meta.kripicard_deposit_id || null,
    kripicard_deposit_id: meta.kripicard_deposit_id || null,
    user_id: deposit.user_id,
    local_deposit_id: deposit.id,
    ref_code: deposit.ref_code,
    amount: Number(provider?.amount_usd ?? meta.amount_usdt ?? deposit.amount_usd),
    deposit_address: provider?.pay_address || meta.pay_address || meta.deposit_address,
    status: completed ? 'COMPLETED' : 'PENDING',
    provider_status: provider?.status || (verified ? 'completed' : 'pending'),
    network: provider?.network || meta.kripicard_network || meta.usdt_network,
    expires_at: meta.expires_at || null,
    credited: completed,
  };
}

/**
 * Credit Master Wallet when Kripicard reports the deposit completed.
 */
async function creditKripicardDepositIfCompleted(deposit, providerStatus) {
  if (!deposit) {
    const err = new Error('Deposit not found');
    err.code = 'DEPOSIT_NOT_FOUND';
    throw err;
  }

  if (String(deposit.status || '').toUpperCase() === 'VERIFIED') {
    return {
      credited: false,
      alreadyVerified: true,
      deposit: enrichDeposit(deposit),
      message: 'Deposit already credited',
    };
  }

  const status = providerStatus || {};
  const completed = status.credited === true || isCompletedStatus(status.status);
  if (!completed) {
    return {
      credited: false,
      pending: true,
      status: status.status || 'pending',
      deposit: enrichDeposit(deposit),
      message: `Deposit still ${status.status || 'pending'}`,
    };
  }

  const meta = parseRecordMetadata(deposit.metadata);
  const netFromProvider = Number(
    status.credited_amount_usd
    ?? status.credited_on_completion_usd
    ?? meta.net_usdt
  );
  if (Number.isFinite(netFromProvider) && netFromProvider > 0) {
    // Refresh metadata net so creditDepositAndVerify uses Kripicard's credit.
    try {
      const db = getDb();
      const next = {
        ...meta,
        net_usdt: netFromProvider,
        fee_usdt: Number(status.fee_usd ?? meta.fee_usdt ?? 0) || 0,
        payment_fee: {
          ...(meta.payment_fee || {}),
          net_usdt: netFromProvider,
          fee_usdt: Number(status.fee_usd ?? meta.fee_usdt ?? 0) || 0,
        },
        pricing: {
          ...(meta.pricing || {}),
          net_usdt: netFromProvider,
        },
      };
      await db.run(
        `UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
        JSON.stringify(next),
        deposit.id
      );
      deposit = await DepositRequest.findById(deposit.id);
    } catch (err) {
      console.warn('[kripicard/deposit] net metadata refresh failed:', err.message);
    }
  }

  const txnId = status.id
    || meta.kripicard_deposit_id
    || meta.order_id
    || deposit.ref_code;

  const { assertTxHashAvailable } = require('./depositService');
  await assertTxHashAvailable(txnId, deposit.id);

  const result = await creditDepositAndVerify(deposit, {
    txnId,
    createdBy: 'kripicard_collection',
    adminNote: `Kripicard deposit.completed — ${meta.kripicard_deposit_id || txnId}`,
  });

  await recordDepositEvent({
    eventId: `completed:${txnId}`,
    depositId: deposit.id,
    providerDepositId: meta.kripicard_deposit_id || status.id,
    orderId: meta.order_id,
    userId: deposit.user_id,
    amountUsdt: result.net_usdt ?? netFromProvider,
    status: 'credited',
    raw: status.raw || status,
    credited: 1,
  });

  return {
    credited: !result.alreadyVerified,
    alreadyVerified: Boolean(result.alreadyVerified),
    deposit: enrichDeposit(result.deposit),
    net_usdt: result.net_usdt,
    fee_usdt: result.fee_usdt,
    gross_usdt: result.gross_usdt,
    ledger: 'master_wallet',
    message: result.alreadyVerified
      ? 'Deposit already credited'
      : `Kripicard deposit confirmed — credited ${formatUsdt(result.net_usdt || 0)} to Master Wallet`,
  };
}

/**
 * Webhook: deposit.completed / deposit.credited → Master Wallet credit.
 */
async function handleKripicardDepositWebhook(req) {
  verifyKripicardWebhookSignature(req);

  const body = req.body || {};
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const eventType = String(
    body.type || body.event || body.event_type || data.type || data.event || ''
  ).trim().toLowerCase();

  const provider = normalizeDepositRecord(body) || normalizeDepositRecord(data);
  const statusHint = String(provider?.status || data.status || body.status || '').toLowerCase();
  const isDepositEvent = eventType.includes('deposit')
    || Boolean(provider?.pay_address)
    || Boolean(data.pay_address)
    || Boolean(data.deposit_id || data.kripicard_deposit_id);

  if (!isDepositEvent && !eventType.includes('deposit')) {
    return {
      ignored: true,
      reason: 'not_deposit_event',
      event_type: eventType || null,
    };
  }

  const completedByEvent = [
    'deposit.completed',
    'deposit.credited',
    'deposit.confirmed',
    'deposit.success',
    'deposits.completed',
  ].includes(eventType.replace(/_/g, '.'));

  if (!completedByEvent && !isCompletedStatus(statusHint) && !(provider && provider.credited)) {
    return {
      ignored: true,
      reason: 'not_completed',
      event_type: eventType || null,
      status: statusHint || null,
    };
  }

  const providerId = provider?.id
    || data.id
    || data.deposit_id
    || data.kripicard_deposit_id
    || null;
  const orderId = provider?.order_id
    || data.order_id
    || data.merchant_order_id
    || null;

  let deposit = null;
  if (providerId) deposit = await findDepositByKripicardId(providerId);
  if (!deposit && orderId) deposit = await findDepositByKripicardId(orderId);

  if (!deposit) {
    const err = new Error(
      `Deposit not found for Kripicard id=${providerId || 'none'} order=${orderId || 'none'}`
    );
    err.code = 'DEPOSIT_NOT_FOUND';
    throw err;
  }

  // Prefer live status when we have a provider id.
  let live = provider;
  if (providerId) {
    try {
      live = await getDepositStatus(providerId);
    } catch (err) {
      console.warn('[kripicard/deposit] webhook live status failed:', err.message);
    }
  }

  return creditKripicardDepositIfCompleted(deposit, live || {
    id: providerId,
    status: 'completed',
    credited: true,
  });
}

/**
 * Poll pending Kripicard deposits and credit when completed.
 */
async function pollPendingKripicardDeposits({ limit = 40 } = {}) {
  const db = getDb();
  const rows = await db.all(`
    SELECT * FROM deposit_requests_v2
    WHERE purpose = 'usdt_topup'
      AND status IN ('PENDING', 'AWAITING_SCREENSHOT', 'SUBMITTED', 'UNDER_REVIEW')
      AND (
        json_extract(metadata, '$.deposit_channel') = 'kripicard_deposit'
        OR json_extract(metadata, '$.payment_provider') = 'kripicard'
        OR json_extract(metadata, '$.kripicard_deposit_id') IS NOT NULL
      )
    ORDER BY id ASC
    LIMIT ?
  `, Math.max(1, Math.min(Number(limit) || 40, 100)));

  const results = {
    ok: true,
    checked: rows.length,
    credited: 0,
    pending: 0,
    errors: [],
  };

  for (const row of rows) {
    const meta = parseRecordMetadata(row.metadata);
    const providerId = meta.kripicard_deposit_id;
    if (!providerId) {
      results.pending += 1;
      continue;
    }
    try {
      const status = await getDepositStatus(providerId);
      const outcome = await creditKripicardDepositIfCompleted(row, status);
      if (outcome.credited) results.credited += 1;
      else if (outcome.pending) results.pending += 1;
      else if (outcome.alreadyVerified) {
        /* already done */
      }
    } catch (err) {
      results.errors.push({
        deposit_id: row.id,
        kripicard_deposit_id: providerId,
        error: err.message,
        code: err.code,
      });
    }
  }

  return results;
}

let pollInFlight = false;

async function runKripicardDepositPollSafely() {
  if (pollInFlight) return { skipped: true, reason: 'poll_in_flight' };
  pollInFlight = true;
  try {
    return await pollPendingKripicardDeposits();
  } catch (err) {
    console.error('[kripicard/deposit/poll]', err.message, err.code || '');
    return {
      ok: false,
      error: err.message,
      code: err.code || 'KRIPICARD_DEPOSIT_POLL_FAILED',
    };
  } finally {
    pollInFlight = false;
  }
}

function startKripicardDepositPoller({ intervalMs } = {}) {
  const enabled = String(process.env.KRIPICARD_DEPOSIT_POLL_ENABLED || 'true').toLowerCase();
  if (enabled === 'false' || enabled === '0') {
    console.log('[kripicard/deposit] background poll disabled');
    return null;
  }

  const ms = Math.max(
    10_000,
    parseInt(process.env.KRIPICARD_DEPOSIT_POLL_MS || String(intervalMs || 30_000), 10) || 30_000
  );

  const timer = setInterval(() => {
    runKripicardDepositPollSafely().catch((err) => {
      console.error('[kripicard/deposit/poll]', err.message);
    });
  }, ms);
  timer.unref?.();

  runKripicardDepositPollSafely().catch((err) => {
    console.error('[kripicard/deposit/poll] initial run failed:', err.message);
  });

  console.log(`[kripicard/deposit] status poll every ${ms}ms`);
  return timer;
}

module.exports = {
  createKripicardCryptoDeposit,
  creditKripicardDepositIfCompleted,
  handleKripicardDepositWebhook,
  findDepositByKripicardId,
  findOrderByOrderId,
  pollPendingKripicardDeposits,
  runKripicardDepositPollSafely,
  startKripicardDepositPoller,
  fetchDepositNetworks,
  generateOrderId,
  minDepositUsd,
};
