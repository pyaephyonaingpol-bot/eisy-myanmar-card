/**
 * NOWPayments Mass Payouts — USDT TRC20 / BEP20 withdrawals.
 *
 * Flow:
 *   1. POST /v1/auth  → JWT (email + password)
 *   2. POST /v1/payout → create batch (x-api-key + Bearer JWT)
 *   3. Optional POST /v1/payout/:id/verify with 2FA
 *   4. IPN updates local usdt_withdrawal_requests when finished / failed
 *
 * Currency tickers (no separate network field):
 *   TRC20 → usdttrc20
 *   BEP20 → usdtbsc
 */
require('../lib/loadEnv');
const crypto = require('crypto');
const { getDb } = require('../db');
const { joinPublicUrl } = require('../lib/publicUrl');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const {
  getNowPaymentsApiBase,
  getNowPaymentsApiKey,
  verifyNowPaymentsSignature,
  sortObjectDeep,
} = require('./nowPaymentsService');
const { creditUsdt, formatUsdt } = require('./walletService');
const { getSetting, setSetting } = require('./settingsService');

const JWT_TTL_MS = 4 * 60 * 1000; // refresh before 5-minute expiry
let cachedJwt = null;
let cachedJwtExpiresAt = 0;

const PAYOUT_CURRENCY_BY_NETWORK = {
  TRC20: 'usdttrc20',
  BEP20: 'usdtbsc',
};

function isNowPaymentsPayoutsEnabled() {
  const flag = String(process.env.NOWPAYMENTS_PAYOUTS_ENABLED || process.env.USDT_AUTO_WITHDRAW_ENABLED || '')
    .trim()
    .toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes') return true;
  // Auto-enable when payout credentials are present
  return Boolean(
    getNowPaymentsApiKey()
    && String(process.env.NOWPAYMENTS_EMAIL || '').trim()
    && String(process.env.NOWPAYMENTS_PASSWORD || '').trim()
  );
}

/**
 * On Vercel/production, live NOWPayments payouts are required unless explicitly disabled.
 * Set NOWPAYMENTS_REQUIRE_LIVE_PAYOUT=false to allow local-only pending queue.
 */
function isLivePayoutRequired() {
  const flag = String(process.env.NOWPAYMENTS_REQUIRE_LIVE_PAYOUT || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes') return true;
  const onVercel = String(process.env.VERCEL || '').trim() === '1'
    || Boolean(String(process.env.VERCEL_ENV || '').trim());
  const isProd = String(process.env.NODE_ENV || '').trim() === 'production';
  return onVercel || isProd;
}

function getNowPaymentsPayoutConfigStatus() {
  const apiKey = Boolean(getNowPaymentsApiKey());
  const email = Boolean(String(process.env.NOWPAYMENTS_EMAIL || '').trim());
  const password = Boolean(String(process.env.NOWPAYMENTS_PASSWORD || '').trim());
  const ipnSecret = Boolean(String(process.env.NOWPAYMENTS_IPN_SECRET || '').trim());
  const twoFaSecret = Boolean(String(process.env.NOWPAYMENTS_PAYOUT_2FA_SECRET || '').trim());
  const twoFaCode = Boolean(String(process.env.NOWPAYMENTS_PAYOUT_VERIFICATION_CODE || '').trim());
  const publicBase = Boolean(
    String(process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || '').trim()
  );

  const missing = [];
  if (!apiKey) missing.push('NOWPAYMENTS_API_KEY');
  if (!email) missing.push('NOWPAYMENTS_EMAIL');
  if (!password) missing.push('NOWPAYMENTS_PASSWORD');
  if (!ipnSecret) missing.push('NOWPAYMENTS_IPN_SECRET');
  if (!publicBase) missing.push('PUBLIC_BASE_URL');

  const credentialsReady = apiKey && email && password;
  const enabled = isNowPaymentsPayoutsEnabled();
  const requireLive = isLivePayoutRequired();
  const twoFaConfigured = twoFaSecret || twoFaCode;

  return {
    enabled,
    require_live: requireLive,
    ready: credentialsReady && enabled,
    credentials_ready: credentialsReady,
    missing,
    has: {
      api_key: apiKey,
      email,
      password,
      ipn_secret: ipnSecret,
      public_base_url: publicBase,
      payout_2fa: twoFaConfigured,
    },
    api_base: getNowPaymentsApiBase(),
    auto_max_usdt: getAutoWithdrawMaxUsdt(),
    warnings: [
      ...(!twoFaConfigured
        ? ['NOWPAYMENTS_PAYOUT_2FA_SECRET (or NOWPAYMENTS_PAYOUT_VERIFICATION_CODE) not set — required if payout 2FA is enabled on the NOWPayments account']
        : []),
      ...(requireLive && !credentialsReady
        ? ['Live payouts required but credentials incomplete — withdrawals will fail closed until Vercel env is fixed']
        : []),
      ...(enabled && !ipnSecret
        ? ['NOWPAYMENTS_IPN_SECRET missing — payout finished/failed webhooks cannot be verified']
        : []),
    ],
  };
}

function assertNowPaymentsPayoutsReady() {
  const status = getNowPaymentsPayoutConfigStatus();
  if (status.ready) return status;

  const missingCreds = ['NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_EMAIL', 'NOWPAYMENTS_PASSWORD']
    .filter((name) => status.missing.includes(name));
  const err = new Error(
    missingCreds.length
      ? `NOWPayments live payouts are not configured. Set in Vercel: ${missingCreds.join(', ')}`
      : 'NOWPayments payouts are disabled (NOWPAYMENTS_PAYOUTS_ENABLED=false)'
  );
  err.code = missingCreds.length ? 'NOWPAYMENTS_PAYOUT_CONFIG_INCOMPLETE' : 'NOWPAYMENTS_PAYOUTS_DISABLED';
  err.config = status;
  throw err;
}

function logNowPaymentsPayoutConfigAtBoot() {
  try {
    const status = getNowPaymentsPayoutConfigStatus();
    const summary = [
      `enabled=${status.enabled}`,
      `require_live=${status.require_live}`,
      `ready=${status.ready}`,
      `api_key=${status.has.api_key}`,
      `email=${status.has.email}`,
      `password=${status.has.password}`,
      `2fa=${status.has.payout_2fa}`,
    ].join(' ');
    if (status.ready) {
      console.log(`[nowpayments-payout] config OK (${summary})`);
    } else {
      console.warn(`[nowpayments-payout] config incomplete (${summary}) missing=[${status.missing.join(', ')}]`);
      for (const w of status.warnings) console.warn(`[nowpayments-payout] ${w}`);
    }
  } catch (err) {
    console.warn('[nowpayments-payout] config check failed:', err.message);
  }
}

function getAutoWithdrawMaxUsdt() {
  const raw = process.env.USDT_AUTO_WITHDRAW_MAX_USDT || process.env.NOWPAYMENTS_PAYOUT_MAX_USDT;
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return null; // no cap
}

function payoutCurrencyForNetwork(network) {
  const key = String(network || '').trim().toUpperCase();
  return PAYOUT_CURRENCY_BY_NETWORK[key] || null;
}

function getPayoutIpnCallbackUrl() {
  return (
    process.env.NOWPAYMENTS_PAYOUT_IPN_CALLBACK_URL
    || joinPublicUrl('/api/nowpayments/payout-webhook')
    || joinPublicUrl('/api/nowpayments/webhook')
    || null
  );
}

/**
 * RFC 6238 TOTP (SHA-1, 30s step, 6 digits) for payout 2FA verification.
 */
function generateTotpCode(secretBase32, { stepSec = 30, digits = 6, nowMs = Date.now() } = {}) {
  const secret = String(secretBase32 || '').trim().replace(/\s+/g, '');
  if (!secret) return null;
  const key = base32Decode(secret);
  if (!key || !key.length) return null;
  const counter = Math.floor(nowMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  ) % (10 ** digits);
  return String(code).padStart(digits, '0');
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = String(input).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) return null;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function resolvePayoutVerificationCode() {
  const staticCode = String(process.env.NOWPAYMENTS_PAYOUT_VERIFICATION_CODE || '').trim();
  if (staticCode) return staticCode;
  const secret = String(process.env.NOWPAYMENTS_PAYOUT_2FA_SECRET || '').trim();
  if (secret) return generateTotpCode(secret);
  return null;
}

async function nowPaymentsPayoutRequest(path, {
  method = 'GET',
  body = null,
  jwt = null,
  requireJwt = true,
} = {}) {
  const apiKey = getNowPaymentsApiKey();
  if (!apiKey) {
    const err = new Error('NOWPayments API key is not configured');
    err.code = 'NOWPAYMENTS_NOT_CONFIGURED';
    throw err;
  }

  const headers = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
  if (requireJwt) {
    const token = jwt || await getNowPaymentsAuthToken();
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${getNowPaymentsApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `NOWPayments payout API error (${response.status})`;
    const err = new Error(message);
    err.code = 'NOWPAYMENTS_PAYOUT_API_ERROR';
    err.status = response.status;
    err.nowpayments = data;
    throw err;
  }

  return data;
}

/**
 * Obtain JWT for mass payouts (valid ~5 minutes). Cached in-process.
 * @see POST /v1/auth
 */
async function getNowPaymentsAuthToken({ force = false } = {}) {
  if (!force && cachedJwt && Date.now() < cachedJwtExpiresAt) {
    return cachedJwt;
  }

  const email = String(process.env.NOWPAYMENTS_EMAIL || '').trim();
  const password = String(process.env.NOWPAYMENTS_PASSWORD || '');
  if (!email || !password) {
    const err = new Error(
      'NOWPayments payout auth is not configured (set NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD)'
    );
    err.code = 'NOWPAYMENTS_PAYOUT_AUTH_MISSING';
    throw err;
  }

  const data = await nowPaymentsPayoutRequest('/auth', {
    method: 'POST',
    body: { email, password },
    requireJwt: false,
  });

  const token = data?.token || data?.access_token;
  if (!token) {
    const err = new Error('NOWPayments /auth response missing token');
    err.code = 'NOWPAYMENTS_PAYOUT_AUTH_FAILED';
    err.nowpayments = data;
    throw err;
  }

  cachedJwt = String(token);
  cachedJwtExpiresAt = Date.now() + JWT_TTL_MS;
  return cachedJwt;
}

async function createNowPaymentsPayoutBatch({ withdrawals, ipnCallbackUrl }) {
  const payload = { withdrawals };
  if (ipnCallbackUrl) payload.ipn_callback_url = ipnCallbackUrl;
  return nowPaymentsPayoutRequest('/payout', {
    method: 'POST',
    body: payload,
  });
}

async function verifyNowPaymentsPayout(batchId, verificationCode) {
  return nowPaymentsPayoutRequest(`/payout/${encodeURIComponent(batchId)}/verify`, {
    method: 'POST',
    body: { verification_code: String(verificationCode) },
  });
}

async function getNowPaymentsPayoutStatus(payoutId) {
  return nowPaymentsPayoutRequest(`/payout/${encodeURIComponent(payoutId)}`, {
    method: 'GET',
  });
}

async function reversePlatformUsdtFee(feeUsdt, { description, referenceType, referenceId } = {}) {
  const amount = Math.round((parseFloat(feeUsdt) || 0) * 100) / 100;
  if (amount <= 0) return null;

  const raw = await getSetting('platform_usdt_revenue_balance');
  const current = Math.round((parseFloat(raw) || 0) * 100) / 100;
  const next = Math.max(0, Math.round((current - amount) * 100) / 100);
  await setSetting('platform_usdt_revenue_balance', next);

  return {
    reversed: amount,
    balance_before: current,
    balance_after: next,
    description: description || `Reversed withdrawal fee ${formatUsdt(amount)}`,
    referenceType,
    referenceId,
  };
}

function extractPayoutIds(payoutResponse) {
  const batchId = payoutResponse?.id != null
    ? String(payoutResponse.id)
    : (payoutResponse?.batch_withdrawal_id != null
      ? String(payoutResponse.batch_withdrawal_id)
      : null);
  const items = Array.isArray(payoutResponse?.withdrawals) ? payoutResponse.withdrawals : [];
  const first = items[0] || {};
  const withdrawalId = first.id != null
    ? String(first.id)
    : (first.withdrawal_id != null ? String(first.withdrawal_id) : null);
  const status = String(first.status || payoutResponse?.status || '').toUpperCase() || null;
  const hash = first.hash || first.tx_hash || null;
  return { batchId, withdrawalId, status, hash, items };
}

/**
 * Create + optionally verify a NOWPayments payout for a local USDT withdrawal row.
 * Marks the row `processing` and stores payout ids.
 */
async function triggerNowPaymentsPayoutForWithdrawal(withdrawal, { force = false } = {}) {
  if (!withdrawal || !withdrawal.id) {
    throw new Error('USDT withdrawal not found');
  }

  if (!isNowPaymentsPayoutsEnabled() && !force) {
    const err = new Error('NOWPayments payouts are not enabled');
    err.code = 'NOWPAYMENTS_PAYOUTS_DISABLED';
    throw err;
  }

  if (String(withdrawal.payout_method || 'crypto') !== 'crypto') {
    const err = new Error('NOWPayments payouts only support crypto wallet withdrawals');
    err.code = 'NOWPAYMENTS_PAYOUT_UNSUPPORTED';
    throw err;
  }

  if (!['pending', 'processing'].includes(String(withdrawal.status))) {
    const err = new Error(`Cannot payout withdrawal in status "${withdrawal.status}"`);
    err.code = 'NOWPAYMENTS_PAYOUT_INVALID_STATUS';
    throw err;
  }

  if (withdrawal.nowpayments_payout_id && !force) {
    return {
      alreadyTriggered: true,
      withdrawal,
      payout_id: withdrawal.nowpayments_payout_id,
      message: 'NOWPayments payout already submitted for this withdrawal',
    };
  }

  const currency = payoutCurrencyForNetwork(withdrawal.network);
  if (!currency) {
    const err = new Error(
      `NOWPayments payout supports TRC20/BEP20 only (got ${withdrawal.network || 'unknown'})`
    );
    err.code = 'NOWPAYMENTS_PAYOUT_UNSUPPORTED_NETWORK';
    throw err;
  }

  const amount = Number(withdrawal.net_usdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Withdrawal net USDT amount is invalid');
  }

  const maxUsdt = getAutoWithdrawMaxUsdt();
  if (maxUsdt != null && amount > maxUsdt && !force) {
    const err = new Error(
      `Net amount ${formatUsdt(amount)} exceeds auto-payout max ${formatUsdt(maxUsdt)} — admin must process manually`
    );
    err.code = 'NOWPAYMENTS_PAYOUT_ABOVE_MAX';
    throw err;
  }

  const address = String(withdrawal.wallet_address || '').trim();
  if (!address) {
    throw new Error('Withdrawal is missing destination wallet address');
  }

  const ipnCallbackUrl = getPayoutIpnCallbackUrl();
  const uniqueId = String(withdrawal.ref_code || `WD-${withdrawal.id}`).slice(0, 64);

  await UsdtWithdrawal.updateStatus(withdrawal.id, {
    status: 'processing',
    adminNote: `Submitting NOWPayments ${currency} payout…`,
  });

  let payoutResponse;
  try {
    payoutResponse = await createNowPaymentsPayoutBatch({
      ipnCallbackUrl,
      withdrawals: [{
        address,
        currency,
        amount,
        ipn_callback_url: ipnCallbackUrl || undefined,
        unique_id: uniqueId,
      }],
    });
  } catch (err) {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'pending',
      adminNote: `NOWPayments payout create failed: ${err.message}`,
    }).catch(() => {});
    throw err;
  }

  let { batchId, withdrawalId, status, hash } = extractPayoutIds(payoutResponse);

  // Verify with 2FA when the account requires it and we have a code/secret.
  const verificationCode = resolvePayoutVerificationCode();
  if (batchId && verificationCode) {
    try {
      const verified = await verifyNowPaymentsPayout(batchId, verificationCode);
      const extracted = extractPayoutIds(verified);
      batchId = extracted.batchId || batchId;
      withdrawalId = extracted.withdrawalId || withdrawalId;
      status = extracted.status || status;
      hash = extracted.hash || hash;
      payoutResponse = verified || payoutResponse;
    } catch (err) {
      // Keep processing — payout may already be queued; admin/IPN can finish it.
      console.warn('[nowpayments-payout] verify failed:', err.message);
      await UsdtWithdrawal.updatePayoutFields(withdrawal.id, {
        status: 'processing',
        adminNote: `NOWPayments payout created (${batchId}); 2FA verify failed: ${err.message}`,
        nowpaymentsPayoutId: batchId,
        nowpaymentsWithdrawalId: withdrawalId,
        payoutProvider: 'nowpayments',
        payoutCurrency: currency,
        txHash: hash || null,
      });
      const refreshed = await UsdtWithdrawal.findById(withdrawal.id);
      return {
        withdrawal: refreshed,
        payout_id: batchId,
        nowpayments_withdrawal_id: withdrawalId,
        status,
        verify_error: err.message,
        nowpayments: payoutResponse,
        message: 'Payout created but 2FA verification failed — check NOWPayments dashboard',
      };
    }
  }

  if (!batchId) {
    await UsdtWithdrawal.updateStatus(withdrawal.id, {
      status: 'pending',
      adminNote: 'NOWPayments payout response missing batch id',
    }).catch(() => {});
    const err = new Error('NOWPayments payout response missing id');
    err.code = 'NOWPAYMENTS_PAYOUT_INVALID_RESPONSE';
    err.nowpayments = payoutResponse;
    throw err;
  }

  const finished = ['FINISHED', 'COMPLETED', 'SUCCESS'].includes(String(status || '').toUpperCase());
  const updated = await UsdtWithdrawal.updatePayoutFields(withdrawal.id, {
    status: finished ? 'completed' : 'processing',
    adminNote: finished
      ? `NOWPayments payout finished (${batchId})`
      : `NOWPayments payout submitted (${batchId})${status ? ` — ${status}` : ''}`,
    nowpaymentsPayoutId: batchId,
    nowpaymentsWithdrawalId: withdrawalId,
    payoutProvider: 'nowpayments',
    payoutCurrency: currency,
    txHash: hash || null,
    processedBy: null,
  });

  return {
    withdrawal: updated,
    payout_id: batchId,
    nowpayments_withdrawal_id: withdrawalId,
    status: status || (finished ? 'FINISHED' : 'PROCESSING'),
    currency,
    amount,
    address,
    nowpayments: payoutResponse,
    message: finished
      ? `Payout finished — ${formatUsdt(amount)} sent via NOWPayments`
      : `Payout submitted — ${formatUsdt(amount)} ${currency} to ${address}`,
  };
}

async function findWithdrawalByNowPaymentsPayoutIds({
  payoutId,
  withdrawalId,
  uniqueId,
  refCode,
} = {}) {
  const db = getDb();
  const candidates = [payoutId, withdrawalId, uniqueId, refCode]
    .map((v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null))
    .filter(Boolean);
  if (!candidates.length) return null;

  for (const value of candidates) {
    const byPayout = await db.get(
      `SELECT * FROM usdt_withdrawal_requests
       WHERE nowpayments_payout_id = ? OR nowpayments_withdrawal_id = ? OR ref_code = ?
       LIMIT 1`,
      value,
      value,
      value
    );
    if (byPayout) return byPayout;
  }
  return null;
}

async function refundFailedNowPaymentsPayout(row, { adminNote, status = 'rejected' } = {}) {
  if (!row) return null;
  if (!['pending', 'processing'].includes(String(row.status))) {
    return UsdtWithdrawal.findById(row.id);
  }

  const note = adminNote || 'NOWPayments payout failed — balance refunded';
  const updated = await UsdtWithdrawal.updateStatus(row.id, {
    status,
    adminNote: note,
  });

  const amount = Number(row.amount_usdt) || 0;
  if (amount > 0) {
    await creditUsdt(row.user_id, amount, {
      description: `USDT withdrawal ${row.ref_code} payout failed — ${formatUsdt(amount)} refunded`,
      referenceType: 'usdt_withdrawal',
      referenceId: row.id,
      createdBy: 'system',
      metadata: {
        purpose: 'usdt_withdrawal_refund',
        refund: true,
        provider: 'nowpayments',
        ref_code: row.ref_code,
        nowpayments_payout_id: row.nowpayments_payout_id,
      },
    });
  }

  if (Number(row.fee_usdt) > 0) {
    await reversePlatformUsdtFee(row.fee_usdt, {
      description: `Reversed fee for failed NOWPayments payout ${row.ref_code}`,
      referenceType: 'usdt_withdrawal_requests',
      referenceId: row.id,
    }).catch((err) => {
      console.warn('[nowpayments-payout] fee reverse skipped:', err.message);
    });
  }

  return updated;
}

/**
 * Handle payout IPN (or deposit webhook that carries payout fields).
 */
async function handleNowPaymentsPayoutWebhook(req) {
  const signature = req.headers['x-nowpayments-sig'] || req.headers['X-NOWPAYMENTS-SIG'];
  const body = req.body;

  if (!body || typeof body !== 'object') {
    const err = new Error('Invalid payout IPN payload');
    err.code = 'NOWPAYMENTS_INVALID_PAYLOAD';
    throw err;
  }

  if (!verifyNowPaymentsSignature(body, signature)) {
    const err = new Error('Invalid NOWPayments IPN signature');
    err.code = 'NOWPAYMENTS_INVALID_SIGNATURE';
    throw err;
  }

  const status = String(
    body.status
    || body.withdrawal_status
    || body.payment_status
    || ''
  ).toUpperCase();

  const payoutId = body.id != null && body.id !== ''
    ? String(body.id)
    : (body.batch_withdrawal_id != null ? String(body.batch_withdrawal_id) : null);
  const withdrawalId = body.withdrawal_id != null && body.withdrawal_id !== ''
    ? String(body.withdrawal_id)
    : null;
  const uniqueId = body.unique_id != null && body.unique_id !== ''
    ? String(body.unique_id)
    : null;
  const hash = body.hash || body.tx_hash || body.txid || null;

  const row = await findWithdrawalByNowPaymentsPayoutIds({
    payoutId,
    withdrawalId,
    uniqueId,
    refCode: uniqueId,
  });

  if (!row) {
    return {
      ok: true,
      ignored: true,
      kind: 'payout',
      payout_id: payoutId,
      message: 'No matching local USDT withdrawal for payout IPN',
    };
  }

  if (row.status === 'completed') {
    return {
      ok: true,
      alreadyFinished: true,
      kind: 'payout',
      payout_id: payoutId,
      withdrawal_id: row.id,
      message: 'Withdrawal already completed',
    };
  }

  if (['FINISHED', 'COMPLETED', 'SUCCESS', 'SENT'].includes(status)) {
    const updated = await UsdtWithdrawal.updatePayoutFields(row.id, {
      status: 'completed',
      adminNote: `NOWPayments payout ${status} (${payoutId || withdrawalId || row.nowpayments_payout_id})`,
      nowpaymentsPayoutId: payoutId || row.nowpayments_payout_id,
      nowpaymentsWithdrawalId: withdrawalId || row.nowpayments_withdrawal_id,
      payoutProvider: 'nowpayments',
      txHash: hash || row.tx_hash,
    });
    return {
      ok: true,
      finished: true,
      kind: 'payout',
      payout_id: payoutId,
      withdrawal_id: row.id,
      tx_hash: hash,
      withdrawal: updated,
      message: 'Withdrawal marked completed from NOWPayments payout IPN',
    };
  }

  if (['FAILED', 'REJECTED', 'REJECTED_NOT_CHECKED', 'EXPIRED', 'CANCELLED'].includes(status)) {
    const updated = await refundFailedNowPaymentsPayout(row, {
      adminNote: `NOWPayments payout ${status} — balance refunded`,
      status: 'rejected',
    });
    return {
      ok: true,
      failed: true,
      refunded: true,
      kind: 'payout',
      payout_id: payoutId,
      withdrawal_id: row.id,
      withdrawal: updated,
      message: `Payout ${status} — user balance refunded`,
    };
  }

  await UsdtWithdrawal.updatePayoutFields(row.id, {
    status: 'processing',
    adminNote: `NOWPayments payout status: ${status || 'unknown'}`,
    nowpaymentsPayoutId: payoutId || row.nowpayments_payout_id,
    nowpaymentsWithdrawalId: withdrawalId || row.nowpayments_withdrawal_id,
    payoutProvider: 'nowpayments',
    txHash: hash || row.tx_hash,
  });

  return {
    ok: true,
    ignored: true,
    kind: 'payout',
    payout_id: payoutId,
    withdrawal_id: row.id,
    status,
    message: `Payout status "${status}" — still processing`,
  };
}

function isPayoutIpnPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.batch_withdrawal_id != null || body.withdrawal_id != null) return true;
  if (body.unique_id && !body.payment_id && !body.invoice_id) return true;
  const status = String(body.status || '').toUpperCase();
  if (body.id && !body.payment_id && !body.invoice_id && !body.order_id) {
    if (['FINISHED', 'FAILED', 'REJECTED', 'WAITING', 'PROCESSING', 'CREATING', 'SENDING'].includes(status)) {
      return true;
    }
  }
  return false;
}

function resetNowPaymentsPayoutAuthCacheForTests() {
  cachedJwt = null;
  cachedJwtExpiresAt = 0;
}

module.exports = {
  isNowPaymentsPayoutsEnabled,
  isLivePayoutRequired,
  getNowPaymentsPayoutConfigStatus,
  assertNowPaymentsPayoutsReady,
  logNowPaymentsPayoutConfigAtBoot,
  getAutoWithdrawMaxUsdt,
  payoutCurrencyForNetwork,
  getNowPaymentsAuthToken,
  createNowPaymentsPayoutBatch,
  verifyNowPaymentsPayout,
  getNowPaymentsPayoutStatus,
  triggerNowPaymentsPayoutForWithdrawal,
  handleNowPaymentsPayoutWebhook,
  findWithdrawalByNowPaymentsPayoutIds,
  isPayoutIpnPayload,
  generateTotpCode,
  resolvePayoutVerificationCode,
  resetNowPaymentsPayoutAuthCacheForTests,
  PAYOUT_CURRENCY_BY_NETWORK,
};
