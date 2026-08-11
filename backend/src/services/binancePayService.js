const crypto = require('crypto');

const BINANCE_PAY_BASE_URL = (process.env.BINANCE_PAY_BASE_URL || 'https://bpay.binanceapi.com').replace(/\/$/, '');
const ORDER_PATH = '/binancepay/openapi/v2/order';
const CERT_PATH = '/binancepay/openapi/certificates';
const QUERY_PATH = '/binancepay/openapi/v2/order/query';

function getCredentials() {
  // Prefer BINANCE_PAY_*; also accept Vercel-style BINANCE_API_KEY / BINANCE_SECRET_KEY
  const apiKey = (
    process.env.BINANCE_PAY_API_KEY
    || process.env.BINANCE_API_KEY
    || ''
  ).trim();
  const apiSecret = (
    process.env.BINANCE_PAY_API_SECRET
    || process.env.BINANCE_SECRET_KEY
    || process.env.BINANCE_API_SECRET
    || ''
  ).trim();
  const merchantId = (
    process.env.BINANCE_MERCHANT_ID
    || process.env.BINANCE_PAY_MERCHANT_ID
    || ''
  ).trim();
  return { apiKey, apiSecret, merchantId };
}

function assertConfigured() {
  const { apiKey, apiSecret, merchantId } = getCredentials();
  if (!apiKey || !apiSecret) {
    const err = new Error(
      'Binance Pay is not configured. Set BINANCE_API_KEY + BINANCE_SECRET_KEY '
      + '(or BINANCE_PAY_API_KEY + BINANCE_PAY_API_SECRET) in Vercel Environment Variables.'
    );
    err.code = 'BINANCE_PAY_NOT_CONFIGURED';
    throw err;
  }
  return { apiKey, apiSecret, merchantId };
}

function generateNonce(length = 32) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Build Binance Pay request signature.
 * payload = timestamp + "\\n" + nonce + "\\n" + body + "\\n"
 * signature = HEX(HMAC-SHA512(payload, secret)).toUpperCase()
 */
function buildSignature({ timestamp, nonce, body, apiSecret }) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body || {});
  const payload = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  return crypto
    .createHmac('sha512', apiSecret)
    .update(payload)
    .digest('hex')
    .toUpperCase();
}

function buildAuthHeaders(bodyObj) {
  const { apiKey, apiSecret } = assertConfigured();
  const timestamp = String(Date.now());
  const nonce = generateNonce(32);
  const body = JSON.stringify(bodyObj || {});
  const signature = buildSignature({ timestamp, nonce, body, apiSecret });

  return {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': apiKey,
      'BinancePay-Signature': signature,
    },
    body,
    timestamp,
    nonce,
  };
}

async function binanceRequest(path, bodyObj) {
  const { headers, body } = buildAuthHeaders(bodyObj);
  const url = `${BINANCE_PAY_BASE_URL}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }

  if (!res.ok) {
    const err = new Error(data?.errorMessage || data?.returnMessage || `Binance Pay HTTP ${res.status}`);
    err.code = 'BINANCE_PAY_HTTP_ERROR';
    err.status = res.status;
    err.binance = data;
    throw err;
  }

  if (data.status === 'ERROR' || (data.code && String(data.code) !== '000000' && data.status !== 'SUCCESS')) {
    const err = new Error(data.errorMessage || data.returnMessage || 'Binance Pay API error');
    err.code = data.code || 'BINANCE_PAY_API_ERROR';
    err.binance = data;
    throw err;
  }

  return data;
}

/**
 * Create a Binance Pay checkout order (v2).
 * @see POST /binancepay/openapi/v2/order
 */
async function createBinancePayOrder({
  merchantTradeNo,
  orderAmount,
  currency = 'USDT',
  description = 'Wallet Deposit',
  goodsName = 'USDT Wallet Deposit',
  terminalType = 'WEB',
  returnUrl,
  cancelUrl,
  webhookUrl,
}) {
  const amount = Math.round(Number(orderAmount) * 100) / 100;
  if (!(amount > 0)) {
    throw new Error('orderAmount must be a positive number');
  }
  if (!merchantTradeNo) {
    throw new Error('merchantTradeNo is required');
  }

  const body = {
    env: { terminalType: String(terminalType || 'WEB').toUpperCase() },
    merchantTradeNo: String(merchantTradeNo).slice(0, 32),
    orderAmount: amount,
    currency: String(currency || 'USDT').toUpperCase(),
    description: String(description || 'Wallet Deposit').slice(0, 256),
    goodsDetails: [
      {
        goodsType: '02',
        goodsCategory: 'Z0000',
        referenceGoodsId: 'wallet-deposit',
        goodsName: String(goodsName || 'USDT Wallet Deposit').slice(0, 256),
        goodsDetail: `Deposit ${amount} ${currency}`,
      },
    ],
  };

  if (returnUrl) body.returnUrl = returnUrl;
  if (cancelUrl) body.cancelUrl = cancelUrl;
  if (webhookUrl) body.webhookUrl = webhookUrl;

  const data = await binanceRequest(ORDER_PATH, body);
  const result = data.data || data.result || {};

  return {
    raw: data,
    prepayId: result.prepayId || result.prepay_id || null,
    terminalType: result.terminalType || body.env.terminalType,
    expireTime: result.expireTime || null,
    qrcodeLink: result.qrcodeLink || result.qrCodeLink || null,
    qrContent: result.qrContent || null,
    checkoutUrl: result.checkoutUrl || result.universalUrl || null,
    deeplink: result.deeplink || result.deeplinkUrl || null,
    universalUrl: result.universalUrl || result.checkoutUrl || null,
    merchantTradeNo: body.merchantTradeNo,
    orderAmount: amount,
    currency: body.currency,
  };
}

async function queryBinancePayOrder({ prepayId, merchantTradeNo }) {
  const body = {};
  if (prepayId) body.prepayId = prepayId;
  if (merchantTradeNo) body.merchantTradeNo = merchantTradeNo;
  if (!body.prepayId && !body.merchantTradeNo) {
    throw new Error('prepayId or merchantTradeNo required');
  }
  return binanceRequest(QUERY_PATH, body);
}

let cachedCertificates = null;
let cachedCertificatesAt = 0;

async function fetchCertificates({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedCertificates && now - cachedCertificatesAt < 60 * 60 * 1000) {
    return cachedCertificates;
  }
  const data = await binanceRequest(CERT_PATH, {});
  const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.certList) ? data.certList : []);
  cachedCertificates = list;
  cachedCertificatesAt = now;
  return list;
}

/**
 * Verify Binance Pay webhook signature (RSA-SHA256 with merchant certificate).
 * Falls back to HMAC-SHA512 when BINANCE_PAY_WEBHOOK_HMAC_FALLBACK=true (dev/testing).
 */
async function verifyWebhookSignature({
  timestamp,
  nonce,
  signature,
  certificateSn,
  rawBody,
}) {
  if (process.env.BINANCE_PAY_WEBHOOK_SKIP_VERIFY === 'true') {
    return { ok: true, skipped: true };
  }

  if (!timestamp || !nonce || !signature || !rawBody) {
    return { ok: false, reason: 'missing_signature_headers' };
  }

  const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;

  if (process.env.BINANCE_PAY_WEBHOOK_HMAC_FALLBACK === 'true') {
    const { apiSecret } = getCredentials();
    if (!apiSecret) return { ok: false, reason: 'missing_secret' };
    const expected = buildSignature({ timestamp, nonce, body: rawBody, apiSecret });
    const ok = expected === String(signature).toUpperCase();
    return { ok, method: 'hmac-sha512' };
  }

  try {
    const certs = await fetchCertificates();
    const sn = String(certificateSn || '');
    const cert = certs.find((c) => String(c.certSerial || c.certSn || c.certificateSn || '') === sn)
      || certs[0];
    const publicKey = cert?.certPublic || cert?.publicKey || cert?.certPublicKey;
    if (!publicKey) {
      return { ok: false, reason: 'certificate_not_found' };
    }

    const pem = String(publicKey).includes('BEGIN PUBLIC KEY')
      ? publicKey
      : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(payload);
    verifier.end();
    const ok = verifier.verify(pem, Buffer.from(String(signature), 'base64'));
    return { ok, method: 'rsa-sha256' };
  } catch (err) {
    console.warn('[binancePay] webhook cert verify failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

function parseWebhookEvent(body) {
  const bizType = body?.bizType || body?.biz_type || null;
  const bizStatus = body?.bizStatus || body?.biz_status || null;
  let data = body?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (_) {
      data = {};
    }
  }
  data = data || {};

  return {
    bizType,
    bizStatus,
    merchantTradeNo: data.merchantTradeNo || data.merchant_trade_no || null,
    prepayId: data.prepayId || data.prepay_id || null,
    transactionId: data.transactionId || data.transactId || data.transaction_id || null,
    totalFee: data.totalFee != null ? Number(data.totalFee) : null,
    currency: data.currency || null,
    openUserId: data.openUserId || null,
    rawData: data,
    isPaySuccess: String(bizStatus || '').toUpperCase() === 'PAY_SUCCESS',
  };
}

function webhookSuccessResponse() {
  return { returnCode: 'SUCCESS', returnMessage: null };
}

function webhookFailureResponse(message = 'FAIL') {
  return { returnCode: 'FAIL', returnMessage: message };
}

module.exports = {
  BINANCE_PAY_BASE_URL,
  ORDER_PATH,
  getCredentials,
  assertConfigured,
  generateNonce,
  buildSignature,
  buildAuthHeaders,
  createBinancePayOrder,
  queryBinancePayOrder,
  fetchCertificates,
  verifyWebhookSignature,
  parseWebhookEvent,
  webhookSuccessResponse,
  webhookFailureResponse,
};
