require('../lib/loadEnv');
const crypto = require('crypto');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { creditUsdt, formatUsdt } = require('./walletService');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const { getDb } = require('../db');
const { joinPublicUrl } = require('../lib/publicUrl');
const { getCardPricingSettings, parseRecordMetadata } = require('./settingsService');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { creditDepositAndVerify, uniqueRefCode, assertTxHashAvailable } = require('./depositService');

const FINISHED_STATUS = 'finished';
const DEFAULT_NOWPAYMENTS_API_BASE = 'https://api.nowpayments.io/v1';
/**
 * NOWPayments ticker for USDT on Tron (TRC20).
 * GET /v1/currencies includes `usdttrc20`, not a generic `usdt`.
 * Dashboard "USDT" enabled ≠ API `pay_currency: "usdt"` (that yields
 * "Currency USDT is currently unavailable"). Do not send `usdt_network`
 * or `network` — those keys are rejected.
 */
const DEFAULT_PAY_CURRENCY = 'usdttrc20';
const INVOICE_ALLOWED_FIELDS = [
  'price_amount',
  'price_currency',
  'pay_currency',
  'ipn_callback_url',
  'order_id',
  'order_description',
  'success_url',
  'cancel_url',
  'partially_paid_url',
  'is_fixed_rate',
  'is_fee_paid_by_user',
];

/**
 * Map app aliases (`usdt`, `trx`, `TRC20`) to the NOWPayments ticker `usdttrc20`.
 * Network is encoded in the ticker; it is not a separate invoice field.
 */
function normalizeNowPaymentsPayCurrency(payCurrency) {
  const compact = String(payCurrency || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact) return DEFAULT_PAY_CURRENCY;

  const usdtTronAliases = new Set(['usdt', 'usdttrc20', 'usdttrc', 'trc20', 'trx']);
  if (usdtTronAliases.has(compact)) return DEFAULT_PAY_CURRENCY;

  return compact;
}

function pickNowPaymentsInvoicePayload(payload) {
  const body = {};
  for (const key of INVOICE_ALLOWED_FIELDS) {
    const value = payload?.[key];
    if (value === undefined || value === null || value === '') continue;
    body[key] = value;
  }
  return body;
}

function getNowPaymentsApiBase() {
  return (
    String(process.env.NOWPAYMENTS_API_BASE_URL || DEFAULT_NOWPAYMENTS_API_BASE).trim()
    || DEFAULT_NOWPAYMENTS_API_BASE
  ).replace(/\/$/, '');
}

/**
 * Recursively sort object keys (NOWPayments IPN requirement).
 */
function sortObjectDeep(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.keys(value).sort().reduce((acc, key) => {
    const child = value[key];
    acc[key] = (child && typeof child === 'object' && !Array.isArray(child))
      ? sortObjectDeep(child)
      : child;
    return acc;
  }, {});
}

/**
 * Verify x-nowpayments-sig using HMAC-SHA512 and NOWPAYMENTS_IPN_SECRET.
 * @see https://nowpayments.io/docs/ipn
 */
function verifyNowPaymentsSignature(payload, signatureHeader) {
  const secret = String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim();
  const signature = String(signatureHeader || '').trim();
  if (!secret || !signature || !payload || typeof payload !== 'object') {
    return false;
  }

  const sorted = sortObjectDeep(payload);
  const message = JSON.stringify(sorted);
  const digest = crypto.createHmac('sha512', secret).update(message).digest('hex');

  try {
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return digest === signature;
  }
}

function getNowPaymentsApiKey() {
  return String(process.env.NOWPAYMENTS_API_KEY || '').trim() || null;
}

function generateNowPaymentsOrderId(userId) {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const uid = String(userId || 0).padStart(4, '0').slice(-6);
  return `NP${Date.now()}${uid}${suffix}`.slice(0, 48);
}

function getNowPaymentsIpnCallbackUrl() {
  return (
    process.env.NOWPAYMENTS_IPN_CALLBACK_URL
    || joinPublicUrl('/api/nowpayments/webhook')
    || null
  );
}

async function nowPaymentsApiRequest(path, body) {
  const apiKey = getNowPaymentsApiKey();
  if (!apiKey) {
    const err = new Error('NOWPayments API key is not configured');
    err.code = 'NOWPAYMENTS_NOT_CONFIGURED';
    throw err;
  }

  const url = `${getNowPaymentsApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `NOWPayments API error (${response.status})`;
    const err = new Error(message);
    err.code = 'NOWPAYMENTS_API_ERROR';
    err.status = response.status;
    err.nowpayments = data;
    throw err;
  }

  return data;
}

/**
 * Create a hosted NOWPayments invoice (checkout page URL).
 * @see POST /v1/invoice
 */
async function createNowPaymentsInvoice(payload) {
  return nowPaymentsApiRequest('/invoice', pickNowPaymentsInvoicePayload(payload));
}

async function insertPendingSupabaseTransaction({
  userId,
  paymentId,
  amount,
  currency = 'USDT',
  orderId,
  metadata = {},
}) {
  const sb = getSupabase();
  if (!sb) return null;

  const row = {
    user_id: String(userId),
    payment_id: String(paymentId),
    amount: Number(amount),
    currency: String(currency || 'USDT').toUpperCase(),
    status: 'pending',
    payment_status: 'waiting',
    order_id: orderId || null,
    metadata,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('transactions')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    console.warn('[nowpayments] Optional Supabase insert skipped:', error.message);
    return null;
  }

  return data;
}

async function findSupabaseTransactionByOrderId(orderId) {
  const sb = getSupabase();
  if (!sb || !orderId) return null;

  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .eq('order_id', String(orderId))
    .maybeSingle();

  if (error) {
    console.warn('[nowpayments] Optional Supabase order lookup skipped:', error.message);
    return null;
  }
  return data;
}

async function syncSupabaseTransactionPaymentId(transactionId, paymentId) {
  const sb = getSupabase();
  if (!sb || !transactionId || !paymentId) return null;

  const { data, error } = await sb
    .from('transactions')
    .update({
      payment_id: String(paymentId),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.warn('[nowpayments] Optional Supabase payment_id sync skipped:', error.message);
    return null;
  }
  return data;
}

async function findDepositByNowPaymentsIds({ orderId, paymentId, invoiceId } = {}) {
  const db = getDb();
  const candidates = [orderId, paymentId, invoiceId]
    .map((value) => (value == null || value === '' ? null : String(value)))
    .filter(Boolean);

  for (const id of candidates) {
    const row = await db.get(`
      SELECT * FROM deposit_requests_v2
      WHERE json_extract(metadata, '$.nowpayments_order_id') = ?
         OR json_extract(metadata, '$.nowpayments_invoice_id') = ?
         OR json_extract(metadata, '$.nowpayments_payment_id') = ?
         OR json_extract(metadata, '$.order_id') = ?
         OR ref_code = ?
      ORDER BY id DESC
      LIMIT 1
    `, id, id, id, id, id);
    if (row) return row;
  }
  return null;
}

async function syncLocalDepositPaymentId(deposit, paymentId) {
  if (!deposit || !paymentId) return deposit;
  const meta = parseRecordMetadata(deposit.metadata);
  if (String(meta.nowpayments_payment_id || '') === String(paymentId)) {
    return deposit;
  }
  const nextMeta = { ...meta, nowpayments_payment_id: String(paymentId) };
  const db = getDb();
  await db.run(
    `UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    JSON.stringify(nextMeta),
    deposit.id
  );
  return DepositRequest.findById(deposit.id);
}

/**
 * Create NOWPayments checkout invoice, persist a local pending deposit
 * (LibSQL / Turso), optionally dual-write to Supabase, and return checkout URL.
 *
 * Supabase is not required for NOWPayments transactions.
 */
async function createNowPaymentsPayment(userId, {
  amount_usdt,
  amount,
  success_url: successUrl,
  cancel_url: cancelUrl,
  order_description: orderDescription,
} = {}) {
  const gross = parseFloat(amount_usdt != null ? amount_usdt : amount);
  if (!Number.isFinite(gross) || gross <= 0) {
    const err = new Error('Positive amount_usdt is required');
    err.code = 'NOWPAYMENTS_INVALID_AMOUNT';
    throw err;
  }

  if (!getNowPaymentsApiKey()) {
    const err = new Error('NOWPayments is not configured');
    err.code = 'NOWPAYMENTS_NOT_CONFIGURED';
    throw err;
  }

  const settings = await getCardPricingSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (gross < minUsdt) {
    const err = new Error(`Minimum NOWPayments deposit is $${Number(minUsdt).toFixed(2)} USDT`);
    err.code = 'NOWPAYMENTS_AMOUNT_TOO_LOW';
    throw err;
  }

  const feeBreakdown = calculateUsdtPaymentFeeBreakdown(gross, settings);
  assertValidPaymentAmount(feeBreakdown, { kind: 'NOWPayments deposit' });

  const orderId = generateNowPaymentsOrderId(userId);
  const ipnCallbackUrl = getNowPaymentsIpnCallbackUrl();
  if (!ipnCallbackUrl) {
    const err = new Error('NOWPayments IPN callback URL is not configured (set PUBLIC_BASE_URL)');
    err.code = 'NOWPAYMENTS_IPN_URL_MISSING';
    throw err;
  }

  // NOWPayments has no generic `usdt` ticker. USDT on Tron is always `usdttrc20`.
  // Do not forward client pay_currency/network — those caused "Currency USDT is
  // currently unavailable" and "usdt_network is not allowed".
  const payCurrency = DEFAULT_PAY_CURRENCY;

  const refCode = await uniqueRefCode();
  const metadata = {
    deposit_currency: 'USDT',
    deposit_channel: 'nowpayments',
    payment_provider: 'nowpayments',
    nowpayments_order_id: orderId,
    order_id: orderId,
    pay_currency: payCurrency,
    usdt_network: 'TRC20',
    amount_usdt: feeBreakdown.amount_usdt,
    gross_usdt: feeBreakdown.amount_usdt,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      provider: 'nowpayments',
      gross_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
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
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_label: feeBreakdown.fee_label,
      is_usdt_topup: true,
      deposit_channel: 'nowpayments',
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: feeBreakdown.amount_usdt,
    refCode,
    paymentMethod: 'NOWPAYMENTS',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: feeBreakdown.amount_usdt,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] NOWPayments deposit ${refCode} — gross ${formatUsdt(feeBreakdown.amount_usdt)}, fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'nowpayments',
      nowpayments_order_id: orderId,
      payment_fee: metadata.payment_fee,
    },
  }).catch((err) => {
    console.warn('[nowpayments] deposit_request log skipped:', err.message);
  });

  const invoicePayload = pickNowPaymentsInvoicePayload({
    price_amount: feeBreakdown.amount_usdt,
    price_currency: 'usd',
    pay_currency: 'usdttrc20',
    order_id: orderId,
    order_description: orderDescription || `Eisy USDT deposit ${orderId}`,
    ipn_callback_url: ipnCallbackUrl,
    success_url: successUrl || joinPublicUrl('/#deposits') || undefined,
    cancel_url: cancelUrl || joinPublicUrl('/#deposits') || undefined,
  });

  let invoice;
  try {
    invoice = await createNowPaymentsInvoice(invoicePayload);
  } catch (err) {
    await DepositRequest.review(deposit.id, {
      status: 'FAILED',
      rejectionReason: err.message || 'NOWPayments invoice creation failed',
      adminNote: 'NOWPayments API error on create',
    }).catch(() => {});
    throw err;
  }

  const invoiceId = invoice?.id != null ? String(invoice.id) : null;
  const checkoutUrl = invoice?.invoice_url || invoice?.payment_url || null;

  if (!invoiceId || !checkoutUrl) {
    await DepositRequest.review(deposit.id, {
      status: 'FAILED',
      rejectionReason: 'NOWPayments invoice response missing id or checkout URL',
      adminNote: 'Invalid NOWPayments invoice response',
    }).catch(() => {});
    const err = new Error('NOWPayments invoice response missing id or checkout URL');
    err.code = 'NOWPAYMENTS_INVALID_RESPONSE';
    err.nowpayments = invoice;
    throw err;
  }

  const nextMeta = {
    ...metadata,
    nowpayments_invoice_id: invoiceId,
    nowpayments_payment_id: invoiceId,
    nowpayments_invoice_url: checkoutUrl,
    nowpayments: invoice,
  };
  const db = getDb();
  await db.run(
    `UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    JSON.stringify(nextMeta),
    deposit.id
  );
  const refreshed = await DepositRequest.findById(deposit.id);

  const transaction = await insertPendingSupabaseTransaction({
    userId,
    paymentId: invoiceId,
    amount: feeBreakdown.net_usdt,
    currency: 'USDT',
    orderId,
    metadata: {
      provider: 'nowpayments',
      invoice_id: invoiceId,
      invoice_url: checkoutUrl,
      deposit_id: refreshed.id,
      deposit_ref: refCode,
      gross_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      pay_currency: invoicePayload.pay_currency,
      fee_breakdown: feeBreakdown,
      nowpayments: invoice,
    },
  });

  return {
    message: 'NOWPayments checkout created',
    provider: 'nowpayments',
    checkout_url: checkoutUrl,
    invoice_url: checkoutUrl,
    payment_id: invoiceId,
    order_id: orderId,
    ref_code: refCode,
    fee_breakdown: feeBreakdown,
    deposit: refreshed,
    transaction,
    invoice,
  };
}

async function resolveSupabaseTransactionForIpn(body) {
  const paymentId = parsePaymentId(body);
  if (paymentId) {
    const byPaymentId = await findSupabaseTransactionByPaymentId(paymentId);
    if (byPaymentId) {
      return { transaction: byPaymentId, paymentId };
    }
  }

  const orderId = body?.order_id != null && body.order_id !== ''
    ? String(body.order_id)
    : null;
  if (orderId) {
    const byOrderId = await findSupabaseTransactionByOrderId(orderId);
    if (byOrderId) {
      const resolvedPaymentId = paymentId || byOrderId.payment_id;
      if (paymentId && String(byOrderId.payment_id) !== String(paymentId)) {
        const synced = await syncSupabaseTransactionPaymentId(byOrderId.id, paymentId);
        return { transaction: synced || byOrderId, paymentId: resolvedPaymentId };
      }
      return { transaction: byOrderId, paymentId: resolvedPaymentId };
    }
  }

  const invoiceId = body?.invoice_id != null && body.invoice_id !== ''
    ? String(body.invoice_id)
    : null;
  if (invoiceId) {
    const byInvoiceId = await findSupabaseTransactionByPaymentId(invoiceId);
    if (byInvoiceId) {
      const resolvedPaymentId = paymentId || byInvoiceId.payment_id;
      if (paymentId && String(byInvoiceId.payment_id) !== String(paymentId)) {
        const synced = await syncSupabaseTransactionPaymentId(byInvoiceId.id, paymentId);
        return { transaction: synced || byInvoiceId, paymentId: resolvedPaymentId };
      }
      return { transaction: byInvoiceId, paymentId: resolvedPaymentId };
    }
  }

  return { transaction: null, paymentId };
}

function parsePaymentId(body) {
  const raw = body?.payment_id ?? body?.id ?? null;
  if (raw == null || raw === '') return null;
  return String(raw);
}

function resolveCreditAmountUsdt(body) {
  const candidates = [
    body?.outcome_amount,
    body?.actually_paid,
    body?.pay_amount,
    body?.price_amount,
  ];
  for (const value of candidates) {
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1e8) / 1e8;
  }
  return null;
}

async function findSupabaseTransactionByPaymentId(paymentId) {
  const sb = getSupabase();
  if (!sb || !paymentId) return null;

  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .eq('payment_id', String(paymentId))
    .maybeSingle();

  if (error) {
    console.warn('[nowpayments] Optional Supabase lookup skipped:', error.message);
    return null;
  }
  return data;
}

async function markSupabaseTransactionFinished(paymentId, { paymentStatus, ipnPayload } = {}) {
  const sb = getSupabase();
  if (!sb || !paymentId) return null;

  const updatePayload = {
    status: FINISHED_STATUS,
    payment_status: paymentStatus || FINISHED_STATUS,
    updated_at: new Date().toISOString(),
  };
  if (ipnPayload) {
    updatePayload.metadata = { ipn: ipnPayload };
  }

  const { data, error } = await sb
    .from('transactions')
    .update(updatePayload)
    .eq('payment_id', String(paymentId))
    .select('*')
    .maybeSingle();

  if (error) {
    console.warn('[nowpayments] Optional Supabase update skipped:', error.message);
    return null;
  }
  return data;
}

/**
 * Credit user balance in Supabase user_wallets and local LibSQL wallet when linked.
 * Used only as a fallback for legacy IPNs that have a Supabase row but no local deposit.
 */
async function creditUserBalanceFromNowPayment({
  userId,
  amountUsdt,
  paymentId,
  currency = 'USDT',
}) {
  const amount = parseFloat(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid credit amount from NOWPayments IPN');
  }

  const sb = getSupabase();
  if (sb && userId) {
    const uid = String(userId);
    const { data: wallet, error: fetchErr } = await sb
      .from('user_wallets')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle();

    if (fetchErr) {
      console.error('[nowpayments] user_wallets fetch failed:', fetchErr.message);
      throw new Error(`Supabase wallet fetch failed: ${fetchErr.message}`);
    }

    const current = Number(wallet?.balance_usdt ?? 0);
    const next = Math.round((current + amount) * 1e4) / 1e4;

    const { error: upsertErr } = await sb.from('user_wallets').upsert({
      user_id: uid,
      email: wallet?.email ?? null,
      name: wallet?.name ?? null,
      balance_mmk: Number(wallet?.balance_mmk ?? 0),
      balance_usdt: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      console.error('[nowpayments] user_wallets upsert failed:', upsertErr.message);
      throw new Error(`Supabase wallet credit failed: ${upsertErr.message}`);
    }
  }

  const localUserId = parseInt(String(userId), 10);
  if (Number.isFinite(localUserId) && localUserId > 0) {
    const user = await User.findById(localUserId);
    if (user) {
      await creditUsdt(localUserId, amount, {
        txType: 'deposit',
        description: `NOWPayments ${currency} deposit finished (${paymentId})`,
        referenceType: 'nowpayments',
        referenceId: paymentId,
        createdBy: 'system',
        metadata: {
          provider: 'nowpayments',
          payment_id: paymentId,
          currency,
        },
      });
    }
  }

  return { credited: true, amount_usdt: amount, user_id: userId };
}

async function creditLocalNowPaymentsDeposit(deposit, {
  paymentId,
  paymentStatus,
  body,
}) {
  const refreshed = await syncLocalDepositPaymentId(deposit, paymentId);
  if (String(refreshed.status || '').toUpperCase() === 'VERIFIED') {
    return {
      ok: true,
      alreadyFinished: true,
      alreadyVerified: true,
      payment_id: paymentId,
      user_id: refreshed.user_id,
      deposit: refreshed,
      message: 'Transaction already finished',
    };
  }

  const txnId = paymentId || refreshed.ref_code;
  await assertTxHashAvailable(txnId, refreshed.id);

  const result = await creditDepositAndVerify(refreshed, {
    txnId,
    createdBy: 'system',
    adminNote: `NOWPayments ${paymentStatus || FINISHED_STATUS} (${txnId})`,
  });

  if (isSupabaseEnabled()) {
    await markSupabaseTransactionFinished(paymentId, {
      paymentStatus,
      ipnPayload: body,
    }).catch((err) => {
      console.warn('[nowpayments] Optional Supabase finish skipped:', err.message);
    });
  }

  return {
    ok: true,
    finished: true,
    alreadyVerified: Boolean(result.alreadyVerified),
    payment_id: paymentId,
    user_id: refreshed.user_id,
    amount_usdt: result.net_usdt,
    deposit: result.deposit,
    credit: {
      credited: !result.alreadyVerified,
      amount_usdt: result.net_usdt,
      user_id: refreshed.user_id,
    },
    message: result.alreadyVerified
      ? 'Transaction already finished'
      : 'Payment finished — local deposit credited',
  };
}

/**
 * Handle NOWPayments IPN (Instant Payment Notification) webhook.
 */
async function handleNowPaymentsWebhook(req) {
  const signature = req.headers['x-nowpayments-sig'] || req.headers['X-NOWPAYMENTS-SIG'];
  const body = req.body;

  if (!body || typeof body !== 'object') {
    const err = new Error('Invalid IPN payload');
    err.code = 'NOWPAYMENTS_INVALID_PAYLOAD';
    throw err;
  }

  if (!verifyNowPaymentsSignature(body, signature)) {
    const err = new Error('Invalid NOWPayments IPN signature');
    err.code = 'NOWPAYMENTS_INVALID_SIGNATURE';
    throw err;
  }

  const paymentId = parsePaymentId(body);
  const orderId = body?.order_id != null && body.order_id !== ''
    ? String(body.order_id)
    : null;
  const invoiceId = body?.invoice_id != null && body.invoice_id !== ''
    ? String(body.invoice_id)
    : null;
  const paymentStatus = String(body.payment_status || body.status || '').toLowerCase();

  if (!paymentId && !orderId && !invoiceId) {
    return {
      ok: true,
      ignored: true,
      message: 'IPN missing payment_id / order_id',
    };
  }

  if (paymentStatus !== FINISHED_STATUS) {
    return {
      ok: true,
      ignored: true,
      payment_id: paymentId,
      order_id: orderId,
      payment_status: paymentStatus,
      message: `Payment status "${paymentStatus}" — no balance update`,
    };
  }

  const localDeposit = await findDepositByNowPaymentsIds({
    orderId,
    paymentId,
    invoiceId,
  });
  if (localDeposit) {
    return creditLocalNowPaymentsDeposit(localDeposit, {
      paymentId: paymentId || invoiceId || orderId,
      paymentStatus,
      body,
    });
  }

  if (!isSupabaseEnabled()) {
    return {
      ok: true,
      ignored: true,
      payment_id: paymentId,
      order_id: orderId,
      message: 'No matching local deposit for payment_id or order_id',
    };
  }

  const { transaction: existing, paymentId: resolvedPaymentId } = await resolveSupabaseTransactionForIpn(body);
  const effectivePaymentId = resolvedPaymentId || paymentId;

  if (!existing) {
    return {
      ok: true,
      ignored: true,
      payment_id: effectivePaymentId,
      message: 'No matching local deposit or Supabase transaction for payment_id or order_id',
    };
  }

  if (String(existing.status || '').toLowerCase() === FINISHED_STATUS) {
    return {
      ok: true,
      alreadyFinished: true,
      payment_id: effectivePaymentId,
      user_id: existing.user_id,
      message: 'Transaction already finished',
    };
  }

  const amountUsdt = parseFloat(existing.metadata?.net_usdt)
    ?? resolveCreditAmountUsdt(body)
    ?? parseFloat(existing.amount)
    ?? null;

  if (!amountUsdt || amountUsdt <= 0) {
    const err = new Error('Could not determine credit amount from IPN or transaction row');
    err.code = 'NOWPAYMENTS_INVALID_AMOUNT';
    throw err;
  }

  const updated = await markSupabaseTransactionFinished(existing.payment_id, {
    paymentStatus,
    ipnPayload: body,
  });

  const creditResult = await creditUserBalanceFromNowPayment({
    userId: existing.user_id,
    amountUsdt,
    paymentId: effectivePaymentId,
    currency: String(body.outcome_currency || body.pay_currency || existing.currency || 'USDT').toUpperCase(),
  });

  return {
    ok: true,
    finished: true,
    payment_id: effectivePaymentId,
    user_id: existing.user_id,
    amount_usdt: amountUsdt,
    transaction: updated,
    credit: creditResult,
    message: 'Payment finished — transaction updated and balance credited',
  };
}

module.exports = {
  sortObjectDeep,
  verifyNowPaymentsSignature,
  getNowPaymentsApiKey,
  getNowPaymentsApiBase,
  normalizeNowPaymentsPayCurrency,
  pickNowPaymentsInvoicePayload,
  createNowPaymentsPayment,
  createNowPaymentsInvoice,
  handleNowPaymentsWebhook,
  creditUserBalanceFromNowPayment,
  resolveSupabaseTransactionForIpn,
  findDepositByNowPaymentsIds,
  DEFAULT_PAY_CURRENCY,
  FINISHED_STATUS,
};
