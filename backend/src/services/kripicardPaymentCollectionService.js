/**
 * Kripicard payment-collection webhook + Master Wallet credit.
 *
 * Flow:
 *   1) createKripicardCollectionDeposit — pending usdt_topup deposit (local)
 *   2) POST /api/webhook/kripicard[/collections|/payments] — signed webhook
 *   3) Verify signature → parse paid event → match deposit/user
 *   4) Optionally re-check collection status at Kripicard
 *   5) creditDepositAndVerify → users.balance_usdt (Master Wallet ledger)
 *
 * Env:
 *   KRIPICARD_WEBHOOK_SECRET — HMAC secret (required in production)
 *   KRIPICARD_API_KEY — merchant API key (verify / outbound)
 *   KRIPICARD_PUBLISHABLE_KEY — optional X-Publishable-Key for /api/v1/*
 *   KRIPICARD_PAYMENT_COLLECTIONS_URL — override verify base
 *     (default https://appapi.kripicard.com/api/v1/payment-collections)
 */

'use strict';

const crypto = require('crypto');
const { getDb } = require('../db');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { getDepositFeeSettings } = require('./settingsService');
const { creditDepositAndVerify, uniqueRefCode } = require('./depositService');
const { formatUsdt } = require('./walletService');
const { enrichDeposit } = require('./depositEnrichment');
const { joinPublicUrl } = require('../lib/publicUrl');
const {
  getKripicardConfig,
  buildAuthHeaders,
  kripicardRequest,
} = require('../../../lib/kripicard');

const DEFAULT_COLLECTIONS_URL =
  'https://appapi.kripicard.com/api/v1/payment-collections';

const PAID_STATUSES = new Set([
  'paid',
  'completed',
  'success',
  'succeeded',
  'pay_success',
  'captured',
  'authorized_and_captured',
]);

const PAID_EVENT_TYPES = new Set([
  'payment.completed',
  'payment.succeeded',
  'payment.paid',
  'payment_collection.paid',
  'payment_collection.completed',
  'payment_collection.succeeded',
  'collection.paid',
  'collection.completed',
  'collection.succeeded',
  'pay_success',
]);

function getWebhookSecret() {
  return String(
    process.env.KRIPICARD_WEBHOOK_SECRET
    || process.env.KRIPICARD_WEBHOOK_SIGNING_SECRET
    || ''
  ).trim();
}

function isKripicardWebhookConfigured() {
  return Boolean(getWebhookSecret());
}

function getCollectionsBaseUrl() {
  return String(
    process.env.KRIPICARD_PAYMENT_COLLECTIONS_URL || DEFAULT_COLLECTIONS_URL
  ).trim().replace(/\/$/, '');
}

function getPublishableKey() {
  return String(
    process.env.KRIPICARD_PUBLISHABLE_KEY
    || process.env.KRIPICARD_PUBLISHABLE_API_KEY
    || ''
  ).trim();
}

function generateMerchantReference(userId) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const uid = String(userId || 0).padStart(4, '0').slice(-6);
  return `KC${Date.now()}${uid}${suffix}`.slice(0, 40);
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeSignatureValue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  // sha256=<hex> | v1=<hex> | t=...,v1=<hex>
  if (value.includes(',')) {
    const parts = value.split(',').map((p) => p.trim());
    for (const part of parts) {
      if (/^v1=/i.test(part) || /^sha256=/i.test(part) || /^sha512=/i.test(part)) {
        value = part;
        break;
      }
    }
  }
  value = value.replace(/^(sha256|sha512|v1)=/i, '').trim();
  return value.toLowerCase();
}

/**
 * Verify HMAC of raw body. Fail closed when secret is configured.
 * Accepts sha256 (default) or sha512 via KRIPICARD_WEBHOOK_ALGO.
 */
function verifyKripicardWebhookSignature(req) {
  const secret = getWebhookSecret();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error(
        'KRIPICARD_WEBHOOK_SECRET is required in production for payment collection webhooks'
      );
      err.code = 'KRIPICARD_WEBHOOK_NOT_CONFIGURED';
      err.status = 503;
      throw err;
    }
    console.warn(
      '[kripicard/payment] KRIPICARD_WEBHOOK_SECRET unset — skipping signature check (non-production)'
    );
    return { ok: true, skipped: true };
  }

  const header =
    req.headers['x-kripicard-signature']
    || req.headers['x-kripicard-webhook-signature']
    || req.headers['x-webhook-signature']
    || req.headers['x-signature']
    || req.headers['kripicard-signature']
    || '';

  if (!header) {
    const err = new Error('Missing Kripicard webhook signature header');
    err.code = 'KRIPICARD_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  const rawBody = req.rawBodyBuffer || req.rawBody;
  const payload = rawBody != null && rawBody !== ''
    ? (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

  const algoEnv = String(process.env.KRIPICARD_WEBHOOK_ALGO || 'sha256').trim().toLowerCase();
  const algo = algoEnv === 'sha512' ? 'sha512' : 'sha256';
  const expected = crypto.createHmac(algo, secret).update(payload).digest('hex');
  const provided = normalizeSignatureValue(header);

  if (!timingSafeEqualHex(expected, provided)) {
    // Also try hex digest of sha256 when header used a different algo label.
    if (algo !== 'sha256') {
      const alt = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (timingSafeEqualHex(alt, provided)) {
        return { ok: true, algo: 'sha256' };
      }
    }
    const err = new Error('Invalid Kripicard webhook signature');
    err.code = 'KRIPICARD_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  return { ok: true, algo };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function unwrapData(body) {
  if (!body || typeof body !== 'object') return {};
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data;
  }
  if (body.payment_collection && typeof body.payment_collection === 'object') {
    return body.payment_collection;
  }
  if (body.collection && typeof body.collection === 'object') {
    return body.collection;
  }
  if (body.payment && typeof body.payment === 'object') {
    return body.payment;
  }
  return body;
}

function normalizeStatus(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isPaidStatus(status) {
  return PAID_STATUSES.has(normalizeStatus(status));
}

function isPaidEventType(eventType) {
  return PAID_EVENT_TYPES.has(normalizeStatus(eventType).replace(/-/g, '.'));
}

/**
 * Normalize webhook / API payloads into a payment-collection event.
 */
function parsePaymentCollectionEvent(body) {
  const root = body && typeof body === 'object' ? body : {};
  const data = unwrapData(root);
  const meta = (data.metadata && typeof data.metadata === 'object')
    ? data.metadata
    : ((root.metadata && typeof root.metadata === 'object') ? root.metadata : {});

  const eventType = pickFirst(
    root.type,
    root.event,
    root.event_type,
    root.eventType,
    data.type,
    data.event,
    data.event_type
  );

  const status = pickFirst(
    data.status,
    data.payment_status,
    data.collection_status,
    root.status,
    root.bizStatus,
    meta.status
  );

  const collectionId = pickFirst(
    data.collection_id,
    data.payment_collection_id,
    data.paymentCollectionId,
    data.id,
    root.collection_id,
    root.payment_collection_id,
    meta.collection_id
  );

  const paymentId = pickFirst(
    data.payment_id,
    data.paymentId,
    data.transaction_id,
    data.transactionId,
    data.txn_id,
    root.payment_id,
    meta.payment_id
  );

  const merchantReference = pickFirst(
    data.merchant_reference,
    data.merchantReference,
    data.merchant_trade_no,
    data.merchantTradeNo,
    data.reference,
    data.external_id,
    data.externalId,
    data.client_reference,
    data.clientReference,
    meta.merchant_reference,
    meta.ref_code,
    meta.eisy_ref_code,
    root.merchant_reference,
    root.reference
  );

  const amountRaw = pickFirst(
    data.amount_usdt,
    data.amountUsdt,
    data.amount_usd,
    data.amountUsd,
    data.amount,
    data.total,
    data.paid_amount,
    data.paidAmount,
    data.value,
    root.amount_usdt,
    root.amount,
    meta.amount_usdt,
    meta.amount
  );

  let amountUsdt = Number(amountRaw);
  // Micro-units (1e6 = $1) when no explicit USDT/USD field and value is huge.
  const hasExplicitUsd = data.amount_usdt != null
    || data.amountUsdt != null
    || data.amount_usd != null
    || data.amountUsd != null
    || meta.amount_usdt != null;
  if (Number.isFinite(amountUsdt) && amountUsdt >= 1000 && !hasExplicitUsd) {
    amountUsdt = amountUsdt / 1e6;
  }

  const currency = String(
    pickFirst(data.currency, data.currency_code, root.currency, meta.currency, 'USDT') || 'USDT'
  ).toUpperCase();

  const userIdRaw = pickFirst(
    data.eisy_user_id,
    data.user_id,
    data.userId,
    meta.eisy_user_id,
    meta.user_id,
    meta.userId,
    root.eisy_user_id,
    root.user_id
  );
  const userId = userIdRaw != null && Number.isFinite(Number(userIdRaw))
    ? Number(userIdRaw)
    : null;

  const eventId = String(
    pickFirst(
      root.id,
      root.event_id,
      root.eventId,
      data.event_id,
      data.eventId,
      paymentId,
      collectionId && merchantReference
        ? `${collectionId}:${merchantReference}`
        : null,
      collectionId,
      merchantReference,
      paymentId
    ) || ''
  ).trim();

  const paidByStatus = isPaidStatus(status);
  const paidByEvent = isPaidEventType(eventType);
  const paidFlag = data.paid === true
    || data.is_paid === true
    || root.paid === true
    || normalizeStatus(root.bizStatus) === 'pay_success';

  return {
    event_id: eventId || null,
    event_type: eventType ? String(eventType) : null,
    status: status ? String(status) : null,
    collection_id: collectionId != null ? String(collectionId) : null,
    payment_id: paymentId != null ? String(paymentId) : null,
    merchant_reference: merchantReference != null ? String(merchantReference) : null,
    amount_usdt: Number.isFinite(amountUsdt) ? amountUsdt : null,
    currency,
    user_id: userId,
    is_paid: Boolean(paidByStatus || paidByEvent || paidFlag),
    metadata: meta,
    raw: root,
  };
}

async function findDepositByMerchantReference(merchantReference) {
  const ref = String(merchantReference || '').trim();
  if (!ref) return null;

  const db = getDb();
  const byMeta = await db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.kripicard_merchant_reference') = ?
       OR json_extract(metadata, '$.merchant_reference') = ?
       OR json_extract(metadata, '$.kripicard_collection_id') = ?
       OR ref_code = ?
    ORDER BY id DESC
    LIMIT 1
  `, ref, ref, ref, ref);

  if (byMeta) return byMeta;
  return DepositRequest.findByRefCode(ref);
}

async function findDepositByCollectionId(collectionId) {
  const id = String(collectionId || '').trim();
  if (!id) return null;
  const db = getDb();
  return db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE json_extract(metadata, '$.kripicard_collection_id') = ?
       OR json_extract(metadata, '$.collection_id') = ?
    ORDER BY id DESC
    LIMIT 1
  `, id, id);
}

/**
 * Optional live verify against Kripicard payment-collections API.
 * Returns { verified, status, amount_usdt, raw } or null when not configurable.
 */
async function fetchPaymentCollectionStatus(collectionId) {
  const id = String(collectionId || '').trim();
  if (!id) return null;

  const { apiKey } = getKripicardConfig();
  const publishable = getPublishableKey();
  if (!apiKey && !publishable) {
    return null;
  }

  const url = `${getCollectionsBaseUrl()}/${encodeURIComponent(id)}`;
  const headers = buildAuthHeaders(apiKey || publishable);
  if (publishable) {
    headers['X-Publishable-Key'] = publishable;
  }
  if (apiKey) {
    // Prefer query+header auth style used elsewhere on appapi.
    const withKey = new URL(url);
    withKey.searchParams.set('api_key', apiKey);
    try {
      const raw = await kripicardRequest(withKey.toString(), {
        method: 'GET',
        headers,
      });
      const parsed = parsePaymentCollectionEvent(raw);
      return {
        verified: parsed.is_paid,
        status: parsed.status,
        amount_usdt: parsed.amount_usdt,
        raw,
      };
    } catch (err) {
      console.warn('[kripicard/payment] collection verify GET failed:', err.message);
    }
  }

  try {
    const raw = await kripicardRequest(url, {
      method: 'GET',
      headers,
    });
    const parsed = parsePaymentCollectionEvent(raw);
    return {
      verified: parsed.is_paid,
      status: parsed.status,
      amount_usdt: parsed.amount_usdt,
      raw,
    };
  } catch (err) {
    console.warn('[kripicard/payment] collection verify failed:', err.message);
    return null;
  }
}

/**
 * Create a pending Master Wallet USDT top-up tied to a Kripicard collection reference.
 */
async function createKripicardCollectionDeposit(userId, {
  amount_usdt,
  amount,
  collection_id = null,
  merchant_reference = null,
  description = null,
} = {}) {
  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    throw new Error('Positive amount_usdt is required');
  }

  const settings = await getDepositFeeSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (gross < minUsdt) {
    throw new Error(`Minimum Kripicard collection deposit is $${Number(minUsdt).toFixed(2)} USDT`);
  }

  const feeBreakdown = calculateUsdtPaymentFeeBreakdown(gross, settings);
  assertValidPaymentAmount(feeBreakdown, { kind: 'Kripicard payment collection' });

  const merchantReference = String(merchant_reference || generateMerchantReference(userId)).trim();
  const refCode = await uniqueRefCode();
  const collectionId = collection_id != null ? String(collection_id).trim() : null;
  const webhookUrl = process.env.KRIPICARD_WEBHOOK_URL
    || joinPublicUrl('/api/webhook/kripicard/collections');

  const metadata = {
    deposit_currency: 'USDT',
    deposit_channel: 'kripicard_collection',
    payment_provider: 'kripicard',
    ledger: 'master_wallet',
    kripicard_merchant_reference: merchantReference,
    merchant_reference: merchantReference,
    kripicard_collection_id: collectionId,
    collection_id: collectionId,
    webhook_url: webhookUrl,
    amount_usdt: feeBreakdown.amount_usdt,
    gross_usdt: feeBreakdown.amount_usdt,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'kripicard',
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
      deposit_channel: 'kripicard_collection',
      ledger: 'master_wallet',
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: feeBreakdown.amount_usdt,
    refCode,
    paymentMethod: 'KRIPICARD_COLLECTION',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    // Schema CHECK only allows TRC20/BEP20/NULL — channel lives in metadata.
    usdtNetwork: null,
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
    description: description
      || `[usdt_topup] Kripicard collection ${refCode} — gross ${formatUsdt(feeBreakdown.amount_usdt)}, fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'kripicard_collection',
      ledger: 'master_wallet',
      kripicard_merchant_reference: merchantReference,
      kripicard_collection_id: collectionId,
      payment_fee: metadata.payment_fee,
    },
  });

  return {
    deposit: enrichDeposit(deposit),
    fee_breakdown: feeBreakdown,
    merchant_reference: merchantReference,
    collection_id: collectionId,
    webhook_url: webhookUrl,
    message: `Pay $${feeBreakdown.amount_usdt.toFixed(2)} via Kripicard. Service fee ${feeBreakdown.fee_label}; Master Wallet credits $${feeBreakdown.net_usdt.toFixed(2)} USDT after success.`,
  };
}

async function recordPaymentEvent(event, { userId = null, depositId = null } = {}) {
  const db = getDb();
  const eventId = String(event.event_id || '').trim();
  if (!eventId) return null;

  const existing = await db.get(
    'SELECT * FROM kripicard_payment_events WHERE event_id = ?',
    eventId
  );
  if (existing) return existing;

  await db.run(
    `INSERT INTO kripicard_payment_events (
      event_id, collection_id, payment_id, merchant_reference,
      user_id, deposit_id, amount_usdt, currency, status, raw_payload, credited
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    eventId,
    event.collection_id || null,
    event.payment_id || null,
    event.merchant_reference || null,
    userId || event.user_id || null,
    depositId || null,
    event.amount_usdt,
    event.currency || 'USDT',
    event.status || event.event_type || 'received',
    event.raw ? JSON.stringify(event.raw) : null
  );

  return db.get('SELECT * FROM kripicard_payment_events WHERE event_id = ?', eventId);
}

async function markPaymentEventCredited(eventId, { userId, depositId } = {}) {
  const db = getDb();
  await db.run(
    `UPDATE kripicard_payment_events
     SET credited = 1,
         status = 'credited',
         user_id = COALESCE(?, user_id),
         deposit_id = COALESCE(?, deposit_id),
         credited_at = datetime('now')
     WHERE event_id = ?`,
    userId || null,
    depositId || null,
    eventId
  );
}

/**
 * Handle signed Kripicard payment-collection webhook.
 * On paid events: verify, update DB, credit Master Wallet (users.balance_usdt).
 */
async function handleKripicardPaymentWebhook(req) {
  verifyKripicardWebhookSignature(req);

  const event = parsePaymentCollectionEvent(req.body || {});
  if (!event.is_paid) {
    return {
      ignored: true,
      event_type: event.event_type,
      status: event.status,
      message: `Ignored non-paid Kripicard event (${event.event_type || event.status || 'unknown'})`,
    };
  }

  if (!event.event_id) {
    const err = new Error('Kripicard webhook missing event / payment / collection id');
    err.code = 'KRIPICARD_WEBHOOK_MISSING_ID';
    err.status = 400;
    throw err;
  }

  const recorded = await recordPaymentEvent(event);
  if (recorded?.credited) {
    return {
      credited: false,
      alreadyVerified: true,
      event_id: event.event_id,
      message: 'Payment collection already credited',
    };
  }

  let deposit = null;
  if (event.merchant_reference) {
    deposit = await findDepositByMerchantReference(event.merchant_reference);
  }
  if (!deposit && event.collection_id) {
    deposit = await findDepositByCollectionId(event.collection_id);
  }

  if (!deposit && event.user_id && event.amount_usdt != null && event.amount_usdt > 0) {
    // No pending deposit — create one from webhook so creditDepositAndVerify can run.
    const created = await createKripicardCollectionDeposit(event.user_id, {
      amount_usdt: event.amount_usdt,
      collection_id: event.collection_id,
      merchant_reference: event.merchant_reference || event.event_id,
      description: `[usdt_topup] Kripicard collection auto-created from webhook ${event.event_id}`,
    });
    deposit = await DepositRequest.findById(created.deposit.id);
  }

  if (!deposit) {
    const err = new Error(
      `Deposit not found for Kripicard collection `
      + `(ref=${event.merchant_reference || 'none'}, collection=${event.collection_id || 'none'})`
    );
    err.code = 'DEPOSIT_NOT_FOUND';
    err.status = 200;
    throw err;
  }

  await recordPaymentEvent(event, {
    userId: deposit.user_id,
    depositId: deposit.id,
  });

  // Persist collection id on deposit metadata when provider sends it later.
  if (event.collection_id) {
    try {
      const db = getDb();
      const meta = typeof deposit.metadata === 'string'
        ? JSON.parse(deposit.metadata || '{}')
        : (deposit.metadata || {});
      if (!meta.kripicard_collection_id) {
        meta.kripicard_collection_id = event.collection_id;
        meta.collection_id = event.collection_id;
        await db.run(
          `UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
          JSON.stringify(meta),
          deposit.id
        );
      }
    } catch (metaErr) {
      console.warn('[kripicard/payment] metadata update failed:', metaErr.message);
    }
  }

  // Optional live re-verify when query-before-credit is enabled (default on).
  const shouldQuery = process.env.KRIPICARD_QUERY_BEFORE_CREDIT !== 'false';
  if (shouldQuery && event.collection_id) {
    const remote = await fetchPaymentCollectionStatus(event.collection_id);
    if (remote) {
      if (remote.status && !remote.verified && !isPaidStatus(remote.status)) {
        const err = new Error(
          `Kripicard collection status is ${remote.status}, not paid`
        );
        err.code = 'KRIPICARD_COLLECTION_UNPAID';
        err.status = 409;
        throw err;
      }
      if (
        remote.amount_usdt != null
        && Number.isFinite(Number(remote.amount_usdt))
        && Number.isFinite(Number(deposit.amount_usd))
      ) {
        const paidAmount = Number(remote.amount_usdt);
        const expected = Number(deposit.amount_usd);
        const tol = Math.max(0.01, expected * 0.005);
        if (Math.abs(paidAmount - expected) > tol) {
          const err = new Error(
            `Kripicard paid amount (${paidAmount}) does not match deposit gross (${expected})`
          );
          err.code = 'KRIPICARD_AMOUNT_MISMATCH';
          err.status = 409;
          throw err;
        }
      }
    }
  } else if (event.amount_usdt != null && Number.isFinite(Number(event.amount_usdt))) {
    const paidAmount = Number(event.amount_usdt);
    const expected = Number(deposit.amount_usd);
    const tol = Math.max(0.01, expected * 0.005);
    if (Number.isFinite(expected) && expected > 0 && Math.abs(paidAmount - expected) > tol) {
      const err = new Error(
        `Kripicard paid amount (${paidAmount}) does not match deposit gross (${expected})`
      );
      err.code = 'KRIPICARD_AMOUNT_MISMATCH';
      err.status = 409;
      throw err;
    }
  }

  const txnId = event.payment_id
    || event.event_id
    || event.collection_id
    || event.merchant_reference;

  const { assertTxHashAvailable } = require('./depositService');
  await assertTxHashAvailable(txnId, deposit.id);

  const result = await creditDepositAndVerify(deposit, {
    txnId,
    createdBy: 'kripicard_collection',
    adminNote: `Kripicard payment collection paid — ${event.collection_id || event.merchant_reference || event.event_id}`,
  });

  await markPaymentEventCredited(event.event_id, {
    userId: deposit.user_id,
    depositId: deposit.id,
  });

  return {
    credited: !result.alreadyVerified,
    alreadyVerified: Boolean(result.alreadyVerified),
    event_id: event.event_id,
    collection_id: event.collection_id,
    merchant_reference: event.merchant_reference,
    deposit: enrichDeposit(result.deposit),
    net_usdt: result.net_usdt,
    fee_usdt: result.fee_usdt,
    gross_usdt: result.gross_usdt,
    ledger: 'master_wallet',
    message: result.alreadyVerified
      ? 'Deposit already credited'
      : `Kripicard collection success — credited ${formatUsdt(result.net_usdt || 0)} to Master Wallet`,
  };
}

module.exports = {
  getWebhookSecret,
  isKripicardWebhookConfigured,
  verifyKripicardWebhookSignature,
  parsePaymentCollectionEvent,
  createKripicardCollectionDeposit,
  handleKripicardPaymentWebhook,
  findDepositByMerchantReference,
  findDepositByCollectionId,
  fetchPaymentCollectionStatus,
  generateMerchantReference,
};
