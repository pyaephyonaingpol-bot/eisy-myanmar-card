const crypto = require('crypto');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { creditUsdt } = require('./walletService');
const User = require('../models/User');

const FINISHED_STATUS = 'finished';

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
    throw new Error('Supabase is not configured');
  }

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
    console.error('[nowpayments] Supabase update failed:', error.message);
    throw new Error(`Supabase transaction update failed: ${error.message}`);
  }
  return data;
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

  if (!isSupabaseEnabled()) {
    const err = new Error('Supabase is required for NOWPayments transaction updates');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const existing = await findSupabaseTransactionByPaymentId(paymentId);
  if (!existing) {
    return {
      ok: true,
      ignored: true,
      payment_id: paymentId,
      message: 'No matching Supabase transaction for payment_id',
    };
  }

  if (String(existing.status || '').toLowerCase() === FINISHED_STATUS) {
    return {
      ok: true,
      alreadyFinished: true,
      payment_id: paymentId,
      user_id: existing.user_id,
      message: 'Transaction already finished',
    };
  }

  const amountUsdt = resolveCreditAmountUsdt(body)
    ?? parseFloat(existing.amount)
    ?? null;

  if (!amountUsdt || amountUsdt <= 0) {
    const err = new Error('Could not determine credit amount from IPN or transaction row');
    err.code = 'NOWPAYMENTS_INVALID_AMOUNT';
    throw err;
  }

  const updated = await markSupabaseTransactionFinished(paymentId, {
    paymentStatus,
    ipnPayload: body,
  });

  const creditResult = await creditUserBalanceFromNowPayment({
    userId: existing.user_id,
    amountUsdt,
    paymentId,
    currency: String(body.outcome_currency || body.pay_currency || existing.currency || 'USDT').toUpperCase(),
  });

  return {
    ok: true,
    finished: true,
    payment_id: paymentId,
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
  handleNowPaymentsWebhook,
  creditUserBalanceFromNowPayment,
  FINISHED_STATUS,
};
