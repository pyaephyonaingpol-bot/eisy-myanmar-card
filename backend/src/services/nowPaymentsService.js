const crypto = require('crypto');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { creditUsdt } = require('./walletService');
const User = require('../models/User');
const { joinPublicUrl } = require('../lib/publicUrl');
const {
  calculateUsdtPaymentFeeBreakdown,
  assertValidPaymentAmount,
} = require('./paymentFeeService');
const { getCardPricingSettings } = require('./settingsService');

const FINISHED_STATUS = 'finished';
const NOWPAYMENTS_API_BASE = (
  process.env.NOWPAYMENTS_API_BASE_URL || 'https://api.nowpayments.io/v1'
).replace(/\/$/, '');

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

  const url = `${NOWPAYMENTS_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
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
  return nowPaymentsApiRequest('/invoice', payload);
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
  let supabaseResult = null;
  if (sb) {
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

    try {
      const { data, error } = await sb
        .from('transactions')
        .insert(row)
        .select('*')
        .single();

      if (error) {
        console.warn('[nowpayments] Supabase insert warning:', error.message);
      } else {
        supabaseResult = data;
      }
    } catch (sbErr) {
      console.warn('[nowpayments] Supabase insert exception:', sbErr.message);
    }
  }

  // Also record in local database deposit_requests for unified admin and user balance tracking
  try {
    const DepositRequest = require('../models/DepositRequest');
    const localUserId = parseInt(String(userId), 10);
    if (Number.isFinite(localUserId) && localUserId > 0) {
      await DepositRequest.create({
        userId: localUserId,
        amountMmk: 0,
        amountUsd: Number(amount),
        refCode: orderId || `NP${paymentId}`,
        paymentMethod: 'USDT (NOWPayments)',
        purpose: 'usdt_topup',
        depositCurrency: 'USDT',
        usdtNetwork: 'TRC20',
        metadata: {
          provider: 'nowpayments',
          payment_id: String(paymentId),
          order_id: orderId,
          currency,
          ...metadata,
        },
      });
    }
  } catch (localErr) {
    console.warn('[nowpayments] Local deposit request sync warning:', localErr.message);
  }

  return supabaseResult || {
    id: paymentId,
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
    console.error('[nowpayments] Supabase order lookup failed:', error.message);
    throw new Error(`Supabase transaction lookup failed: ${error.message}`);
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
    console.error('[nowpayments] Supabase payment_id sync failed:', error.message);
    throw new Error(`Supabase payment_id sync failed: ${error.message}`);
  }
  return data;
}

/**
 * Create NOWPayments checkout invoice, persist pending Supabase transaction, return checkout URL.
 */
async function createNowPaymentsPayment(userId, {
  amount_usdt,
  amount,
  pay_currency = 'usdttrc20',
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
    const err = new Error('NOWPayments is not configured (missing NOWPAYMENTS_API_KEY in .env)');
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

  const invoicePayload = {
    price_amount: feeBreakdown.amount_usdt,
    price_currency: 'usd',
    pay_currency: String(pay_currency || 'usdttrc20').toLowerCase(),
    order_id: orderId,
    order_description: orderDescription || `Eisy USDT deposit ${orderId}`,
    ipn_callback_url: ipnCallbackUrl,
    success_url: successUrl || joinPublicUrl('/#deposits') || undefined,
    cancel_url: cancelUrl || joinPublicUrl('/#deposits') || undefined,
  };

  const invoice = await createNowPaymentsInvoice(invoicePayload);
  const invoiceId = invoice?.id != null ? String(invoice.id) : null;
  const checkoutUrl = invoice?.invoice_url || invoice?.payment_url || null;

  if (!invoiceId || !checkoutUrl) {
    const err = new Error('NOWPayments invoice response missing id or checkout URL');
    err.code = 'NOWPAYMENTS_INVALID_RESPONSE';
    err.nowpayments = invoice;
    throw err;
  }

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
    fee_breakdown: feeBreakdown,
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
  if (!sb) return null;

  const { data, error } = await sb
    .from('transactions')
    .select('*')
    .eq('payment_id', String(paymentId))
    .maybeSingle();

  if (error) {
    console.error('[nowpayments] Supabase lookup failed:', error.message);
    throw new Error(`Supabase transaction lookup failed: ${error.message}`);
  }
  return data;
}

async function markSupabaseTransactionFinished(paymentId, { paymentStatus, ipnPayload } = {}) {
  const sb = getSupabase();
  if (!sb) {
    return { payment_id: paymentId, status: FINISHED_STATUS };
  }

  const updatePayload = {
    status: FINISHED_STATUS,
    payment_status: paymentStatus || FINISHED_STATUS,
    updated_at: new Date().toISOString(),
  };
  if (ipnPayload) {
    updatePayload.metadata = { ipn: ipnPayload };
  }

  try {
    const { data, error } = await sb
      .from('transactions')
      .update(updatePayload)
      .eq('payment_id', String(paymentId))
      .select('*')
      .maybeSingle();

    if (error) {
      console.warn('[nowpayments] Supabase update warning:', error.message);
    }
    return data || { payment_id: paymentId, status: FINISHED_STATUS };
  } catch (err) {
    console.warn('[nowpayments] Supabase update exception:', err.message);
    return { payment_id: paymentId, status: FINISHED_STATUS };
  }
}

/**
 * Credit user balance in Supabase user_wallets and local LibSQL wallet when linked.
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
  const paymentStatus = String(body.payment_status || body.status || '').toLowerCase();

  if (!paymentId) {
    return {
      ok: true,
      ignored: true,
      message: 'IPN missing payment_id',
    };
  }

  if (paymentStatus !== FINISHED_STATUS) {
    return {
      ok: true,
      ignored: true,
      payment_id: paymentId,
      payment_status: paymentStatus,
      message: `Payment status "${paymentStatus}" — no balance update`,
    };
  }

  const { transaction: existing, paymentId: resolvedPaymentId } = await resolveSupabaseTransactionForIpn(body);
  const effectivePaymentId = resolvedPaymentId || paymentId;

  // If transaction row exists and is already marked finished, avoid duplicate credit
  if (existing && String(existing.status || '').toLowerCase() === FINISHED_STATUS) {
    return {
      ok: true,
      alreadyFinished: true,
      payment_id: effectivePaymentId,
      user_id: existing.user_id,
      message: 'Transaction already finished',
    };
  }

  const amountUsdt = parseFloat(existing?.metadata?.net_usdt)
    ?? resolveCreditAmountUsdt(body)
    ?? (existing ? parseFloat(existing.amount) : null);

  if (!amountUsdt || amountUsdt <= 0) {
    const err = new Error('Could not determine credit amount from IPN or transaction row');
    err.code = 'NOWPAYMENTS_INVALID_AMOUNT';
    throw err;
  }

  // Resolve user id from transaction row, order_id, or metadata
  let targetUserId = existing?.user_id || body?.order_id || null;
  if (typeof targetUserId === 'string' && targetUserId.startsWith('NP')) {
    // Extract user ID embedded in NP order id format: NP<timestamp><paddedUserId><suffix>
    const match = targetUserId.match(/^NP\d{10,14}(\d{4,6})/);
    if (match) targetUserId = parseInt(match[1], 10);
  }

  const updated = await markSupabaseTransactionFinished(existing?.payment_id || effectivePaymentId, {
    paymentStatus,
    ipnPayload: body,
  });

  const creditResult = await creditUserBalanceFromNowPayment({
    userId: targetUserId,
    amountUsdt,
    paymentId: effectivePaymentId,
    currency: String(body.outcome_currency || body.pay_currency || existing?.currency || 'USDT').toUpperCase(),
  });

  return {
    ok: true,
    finished: true,
    payment_id: effectivePaymentId,
    user_id: targetUserId,
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
  createNowPaymentsPayment,
  createNowPaymentsInvoice,
  handleNowPaymentsWebhook,
  creditUserBalanceFromNowPayment,
  resolveSupabaseTransactionForIpn,
  FINISHED_STATUS,
};
