/**
 * Bitnob virtual-card API client.
 *
 * Auth: HMAC-SHA256 over `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`
 * Base URL: https://api.bitnob.com (sandbox vs prod is selected by the secret key)
 *
 * Amounts: Bitnob card endpoints use micro-units (1 USD = 1_000_000).
 *
 * Docs:
 *   https://bitnob.dev/docs/card-issuing/virtual-card-api-endpoint-reference
 *   https://bitnob.dev/api-reference/virtual-cards
 */

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://api.bitnob.com';
const DEFAULT_TIMEOUT_MS = 30000;
const MICROUNITS_PER_UNIT = 1_000_000;

function getBitnobConfig() {
  const clientId = String(process.env.BITNOB_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.BITNOB_CLIENT_SECRET || process.env.BITNOB_SECRET_KEY || ''
  ).trim();
  const baseUrl = String(process.env.BITNOB_API_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  const timeoutMs = Number(process.env.BITNOB_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const webhookUrl = String(process.env.BITNOB_CARD_WEBHOOK_URL || '').trim() || null;
  const minAmountUsd = Number(process.env.BITNOB_MIN_AMOUNT_USD);
  return {
    clientId,
    clientSecret,
    baseUrl,
    timeoutMs,
    webhookUrl,
    minAmountUsd:
      Number.isFinite(minAmountUsd) && minAmountUsd > 0 ? minAmountUsd : 1,
  };
}

function assertConfigured() {
  const { clientId, clientSecret } = getBitnobConfig();
  if (!clientId || !clientSecret || clientSecret.includes('...')) {
    const err = new Error('Bitnob API credentials are not configured (BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET)');
    err.code = 'BITNOB_NOT_CONFIGURED';
    throw err;
  }
  return { clientId, clientSecret };
}

function usdToMicrounits(amountUsd) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('amount must be a non-negative number');
    err.code = 'BITNOB_INVALID_AMOUNT';
    throw err;
  }
  return Math.round(n * MICROUNITS_PER_UNIT);
}

function microunitsToUsd(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / MICROUNITS_PER_UNIT) * 1e6) / 1e6;
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function canonicalizeBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  // Compact JSON — must match the bytes we send so the HMAC verifies.
  return JSON.stringify(body);
}

function buildAuthHeaders({ clientId, clientSecret, bodyString = '' } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = bodyString == null ? '' : String(bodyString);
  const message = `${clientId}:${timestamp}:${nonce}:${payload}`;
  const signature = crypto
    .createHmac('sha256', clientSecret)
    .update(message, 'utf8')
    .digest('hex');

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Auth-Client': clientId,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': signature,
  };
}

function unwrapData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function extractErrorMessage(payload, status) {
  if (!payload || typeof payload !== 'object') {
    return `Bitnob HTTP ${status}`;
  }
  return (
    pick(
      payload.message,
      payload.error,
      payload.msg,
      payload.data?.message,
      payload.data?.error
    ) || `Bitnob HTTP ${status}`
  );
}

/**
 * Low-level HTTP helper for Bitnob.
 * @param {string} path - Absolute path beginning with /api/...
 * @param {{ method?: string, body?: object|null, timeoutMs?: number }} [opts]
 */
async function bitnobRequest(path, { method = 'GET', body = null, timeoutMs } = {}) {
  const { clientId, clientSecret } = assertConfigured();
  const { baseUrl, timeoutMs: defaultTimeout } = getBitnobConfig();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const bodyString = method === 'GET' || method === 'HEAD' || body == null
    ? ''
    : canonicalizeBody(body);
  const headers = buildAuthHeaders({ clientId, clientSecret, bodyString });
  const ms = Number(timeoutMs) || defaultTimeout;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method,
      headers,
      body: bodyString || undefined,
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(`Bitnob request timed out after ${ms}ms`);
      timeoutErr.code = 'BITNOB_TIMEOUT';
      throw timeoutErr;
    }
    const netErr = new Error(err.message || 'Bitnob network error');
    netErr.code = 'BITNOB_NETWORK_ERROR';
    netErr.cause = err;
    throw netErr;
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      const err = new Error(`Bitnob returned non-JSON (HTTP ${res.status})`);
      err.code = 'BITNOB_BAD_RESPONSE';
      err.status = res.status;
      err.raw = text.slice(0, 500);
      throw err;
    }
  }

  if (!res.ok) {
    const err = new Error(extractErrorMessage(payload, res.status));
    err.code = 'BITNOB_HTTP_ERROR';
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  if (payload && payload.success === false) {
    const err = new Error(extractErrorMessage(payload, res.status));
    err.code = 'BITNOB_API_ERROR';
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return { status: res.status, payload, data: unwrapData(payload) };
}

/**
 * Normalize a Bitnob card object into a stable shape for our wallet/card flows.
 */
function normalizeBitnobCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const card = raw.card && typeof raw.card === 'object' ? raw.card : raw;
  const id = pick(card.id, card.card_id, card.cardId);
  if (!id) return null;

  const balanceMicro = pick(
    card.balance_amount,
    card.balanceAmount,
    card.balance
  );
  const displayAmount = pick(card.display_amount, card.displayAmount);
  const balanceUsd =
    displayAmount != null && Number.isFinite(Number(displayAmount))
      ? Number(displayAmount)
      : microunitsToUsd(balanceMicro);

  return {
    provider: 'bitnob',
    card_id: String(id),
    customer_id: pick(card.customer_id, card.customerId) != null
      ? String(pick(card.customer_id, card.customerId))
      : null,
    name: pick(card.name, card.preferred_name, card.preferredName, card.name_on_card),
    card_type: pick(card.card_type, card.cardType, 'virtual'),
    status: pick(card.status),
    created_status: pick(card.created_status, card.createdStatus),
    masked_pan: pick(card.masked_pan, card.maskedPan, card.last4, card.last_4),
    balance_amount_micro: balanceMicro != null ? String(balanceMicro) : null,
    balance_usd: balanceUsd,
    balance_currency: pick(card.balance_currency, card.balanceCurrency, card.currency, 'USD'),
    reference: pick(card.reference),
    webhook_url: pick(card.webhook_url, card.webhookUrl),
    contactless_payment: Boolean(pick(card.contactless_payment, card.contactlessPayment)),
    spending_limits: pick(card.spending_limits, card.card_limits, card.cardLimits) || null,
    billing_address: pick(card.billing_address, card.billingAddress) || null,
    created_at: pick(card.created_at, card.createdAt),
    updated_at: pick(card.updated_at, card.updatedAt),
    raw: card,
  };
}

/**
 * Create a Bitnob virtual card.
 *
 * Requires a KYC-verified `customerId` from Bitnob Card KYC.
 * Initial `amountUsd` funds the card at creation (micro-units on the wire).
 *
 * @param {{
 *   customerId: string,
 *   name: string,
 *   amountUsd: number,
 *   currency?: string,
 *   cardType?: string,
 *   reference?: string,
 *   webhookUrl?: string,
 *   contactlessPayment?: boolean,
 *   createdBy?: string,
 *   cardBrand?: string,
 *   cardLimits?: object,
 *   extra?: object,
 *   timeoutMs?: number,
 * }} opts
 */
async function createVirtualCard({
  customerId,
  name,
  amountUsd,
  currency = 'USD',
  cardType = 'virtual',
  reference,
  webhookUrl,
  contactlessPayment,
  createdBy,
  cardBrand,
  cardLimits,
  extra = {},
  timeoutMs,
} = {}) {
  const { minAmountUsd, webhookUrl: defaultWebhook } = getBitnobConfig();
  const customer = String(customerId || '').trim();
  const cardName = String(name || '').trim();
  const amountNum = Number(amountUsd);

  if (!customer) {
    const err = new Error('customer_id is required (complete Bitnob Card KYC first)');
    err.code = 'BITNOB_CUSTOMER_REQUIRED';
    throw err;
  }
  if (cardName.length < 2) {
    const err = new Error('name must be at least 2 characters');
    err.code = 'BITNOB_INVALID_NAME';
    throw err;
  }
  if (!Number.isFinite(amountNum) || amountNum < minAmountUsd) {
    const err = new Error(`amountUsd must be at least ${minAmountUsd}`);
    err.code = 'BITNOB_INVALID_AMOUNT';
    throw err;
  }

  const body = {
    card_type: cardType || 'virtual',
    name: cardName,
    currency: String(currency || 'USD').toUpperCase(),
    amount: usdToMicrounits(amountNum),
    customer_id: customer,
    ...extra,
  };

  const ref = String(reference || '').trim();
  if (ref) body.reference = ref;

  const hook = String(webhookUrl || defaultWebhook || '').trim();
  if (hook) body.webhook_url = hook;

  if (contactlessPayment !== undefined) {
    body.contactless_payment = Boolean(contactlessPayment);
  }
  if (createdBy) body.created_by = String(createdBy);
  if (cardBrand) body.brand = String(cardBrand);
  if (cardLimits && typeof cardLimits === 'object') body.card_limits = cardLimits;

  const { payload, data } = await bitnobRequest('/api/cards', {
    method: 'POST',
    body,
    timeoutMs,
  });

  const cardRaw = pick(data?.card, data) || data;
  const card = normalizeBitnobCard(cardRaw);
  if (!card?.card_id) {
    const err = new Error('Bitnob create card response missing card id');
    err.code = 'BITNOB_MISSING_CARD_ID';
    err.payload = payload;
    throw err;
  }

  return {
    card,
    request: {
      customer_id: customer,
      name: cardName,
      currency: body.currency,
      amount_usd: amountNum,
      amount_microunits: body.amount,
      reference: body.reference || null,
    },
    raw: payload,
  };
}

/**
 * Fund (or withdraw from) a Bitnob virtual card.
 * Funding is asynchronous — status starts as pending.
 *
 * @param {{
 *   cardId: string,
 *   amountUsd: number,
 *   reference: string,
 *   type?: 'fund'|'withdraw',
 *   timeoutMs?: number,
 * }} opts
 */
async function fundCard({
  cardId,
  amountUsd,
  reference,
  type = 'fund',
  timeoutMs,
} = {}) {
  const id = String(cardId || '').trim();
  const ref = String(reference || '').trim();
  const amountNum = Number(amountUsd);
  const op = String(type || 'fund').toLowerCase();

  if (!id) {
    const err = new Error('cardId is required');
    err.code = 'BITNOB_CARD_ID_REQUIRED';
    throw err;
  }
  if (!ref) {
    const err = new Error('reference is required for fund/withdraw idempotency');
    err.code = 'BITNOB_REFERENCE_REQUIRED';
    throw err;
  }
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    const err = new Error('amountUsd must be a positive number');
    err.code = 'BITNOB_INVALID_AMOUNT';
    throw err;
  }
  if (op !== 'fund' && op !== 'withdraw') {
    const err = new Error("type must be 'fund' or 'withdraw'");
    err.code = 'BITNOB_INVALID_TYPE';
    throw err;
  }

  const body = {
    type: op,
    amount: usdToMicrounits(amountNum),
    reference: ref,
  };

  const { payload, data } = await bitnobRequest(`/api/cards/${encodeURIComponent(id)}/balance`, {
    method: 'POST',
    body,
    timeoutMs,
  });

  const transaction = pick(data?.transaction, data) || null;
  return {
    card_id: id,
    type: op,
    amount_usd: amountNum,
    amount_microunits: body.amount,
    reference: ref,
    transaction,
    status: pick(transaction?.status, data?.status, 'pending'),
    raw: payload,
  };
}

/**
 * Retrieve general card details (balance, status, masked PAN).
 * Does not return full PAN / CVV — use getSecureCardDetails for that.
 */
async function getCardDetails(cardId, { timeoutMs } = {}) {
  const id = String(cardId || '').trim();
  if (!id) {
    const err = new Error('cardId is required');
    err.code = 'BITNOB_CARD_ID_REQUIRED';
    throw err;
  }

  const { payload, data } = await bitnobRequest(`/api/cards/${encodeURIComponent(id)}`, {
    method: 'GET',
    timeoutMs,
  });

  const cardRaw = pick(data?.card, data) || data;
  const card = normalizeBitnobCard(cardRaw);
  if (!card?.card_id) {
    const err = new Error('Bitnob get card response missing card id');
    err.code = 'BITNOB_MISSING_CARD_ID';
    err.payload = payload;
    throw err;
  }

  return { card, raw: payload };
}

/**
 * Retrieve encrypted secure card details (PAN / CVV / expiry).
 * Caller must decrypt with the RSA private key registered with Bitnob.
 * Never log or persist the decrypted payload.
 */
async function getSecureCardDetails(cardId, { timeoutMs } = {}) {
  const id = String(cardId || '').trim();
  if (!id) {
    const err = new Error('cardId is required');
    err.code = 'BITNOB_CARD_ID_REQUIRED';
    throw err;
  }

  const { payload, data } = await bitnobRequest(`/api/cards/${encodeURIComponent(id)}/secure`, {
    method: 'GET',
    timeoutMs,
  });

  return {
    card_id: id,
    encrypted_details: pick(data?.encrypted_details, data?.encryptedDetails) || null,
    balance_amount: pick(data?.balance_amount, data?.balanceAmount) || null,
    balance_usd: microunitsToUsd(pick(data?.balance_amount, data?.balanceAmount)),
    data,
    raw: payload,
  };
}

/** Quick credential check via Bitnob whoami. */
async function validateAuth({ timeoutMs } = {}) {
  const { payload, data } = await bitnobRequest('/api/whoami', {
    method: 'GET',
    timeoutMs,
  });
  return { data, raw: payload };
}

module.exports = {
  MICROUNITS_PER_UNIT,
  getBitnobConfig,
  assertConfigured,
  usdToMicrounits,
  microunitsToUsd,
  buildAuthHeaders,
  canonicalizeBody,
  bitnobRequest,
  normalizeBitnobCard,
  createVirtualCard,
  fundCard,
  getCardDetails,
  getSecureCardDetails,
  validateAuth,
};
