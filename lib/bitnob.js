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
/** Shared with backend/scripts/bitnob-egress-proxy.js */
const EGRESS_PROXY_KEY_HEADER = 'X-Eisy-Bitnob-Proxy-Key';

function getBitnobConfig() {
  const clientId = String(process.env.BITNOB_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.BITNOB_CLIENT_SECRET || process.env.BITNOB_SECRET_KEY || ''
  ).trim();
  const baseUrl = String(
    process.env.BITNOB_API_BASE_URL
    || process.env.BITNOB_BASE_URL
    || DEFAULT_BASE_URL
  )
    .trim()
    .replace(/\/$/, '');
  // Optional fixed-IP reverse proxy (VPS). When set, requests go here instead of baseUrl.
  const egressProxyUrl = String(process.env.BITNOB_EGRESS_PROXY_URL || '')
    .trim()
    .replace(/\/$/, '') || null;
  const egressProxySecret = String(process.env.BITNOB_EGRESS_PROXY_SECRET || '').trim() || null;
  const timeoutMs = Number(process.env.BITNOB_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const webhookUrl = String(
    process.env.BITNOB_CARD_WEBHOOK_URL || process.env.BITNOB_WEBHOOK_URL || ''
  ).trim() || null;
  const minAmountUsd = Number(process.env.BITNOB_MIN_AMOUNT_USD);
  return {
    clientId,
    clientSecret,
    baseUrl,
    /** Effective request origin: egress proxy when configured, else Bitnob API. */
    requestBaseUrl: egressProxyUrl || baseUrl,
    egressProxyUrl,
    egressProxySecret,
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
  const {
    requestBaseUrl,
    egressProxyUrl,
    egressProxySecret,
    timeoutMs: defaultTimeout,
  } = getBitnobConfig();
  if (egressProxyUrl && !egressProxySecret) {
    const err = new Error(
      'BITNOB_EGRESS_PROXY_URL is set but BITNOB_EGRESS_PROXY_SECRET is missing'
    );
    err.code = 'BITNOB_EGRESS_PROXY_NOT_CONFIGURED';
    throw err;
  }
  const url = `${requestBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const bodyString = method === 'GET' || method === 'HEAD' || body == null
    ? ''
    : canonicalizeBody(body);
  const headers = buildAuthHeaders({ clientId, clientSecret, bodyString });
  if (egressProxySecret) {
    headers[EGRESS_PROXY_KEY_HEADER] = egressProxySecret;
  }
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

/**
 * Company wallet balances (USDT/USDC/BTC/NGN). Used to confirm Bitnob float
 * before card create/fund — never mixed with Master Wallet ledger.
 */
async function getBalances({ timeoutMs } = {}) {
  const { payload, data } = await bitnobRequest('/api/balances', {
    method: 'GET',
    timeoutMs,
  });
  return { data, raw: payload };
}

async function getBalanceByCurrency(currency, { timeoutMs } = {}) {
  const code = String(currency || 'USDT').trim().toUpperCase();
  const { payload, data } = await bitnobRequest(
    `/api/balances/${encodeURIComponent(code)}`,
    { method: 'GET', timeoutMs }
  );
  return { currency: code, data, raw: payload };
}

/**
 * Generate a Bitnob stablecoin deposit address for a KYC customer.
 * Incoming deposits credit the Bitnob company wallet (not Master Wallet).
 */
async function generateDepositAddress({
  chain,
  customerEmail,
  label,
  reference,
  timeoutMs,
} = {}) {
  const chainName = String(chain || process.env.BITNOB_DEPOSIT_CHAIN || 'tron')
    .trim()
    .toLowerCase();
  if (!chainName) {
    const err = new Error('chain is required to generate a Bitnob deposit address');
    err.code = 'BITNOB_CHAIN_REQUIRED';
    throw err;
  }

  const body = { chain: chainName };
  if (customerEmail) body.customer_email = String(customerEmail).trim().toLowerCase();
  if (label) body.label = String(label).trim().slice(0, 120);
  if (reference) body.reference = String(reference).trim().slice(0, 120);

  const { payload, data } = await bitnobRequest('/api/addresses', {
    method: 'POST',
    body,
    timeoutMs,
  });

  return {
    id: pick(data?.id, data?.address_id, data?.addressId),
    address: pick(data?.address, data?.deposit_address, data?.depositAddress),
    chain: pick(data?.chain, chainName),
    status: pick(data?.status),
    label: pick(data?.label),
    reference: pick(data?.reference, reference),
    customer_email: customerEmail || null,
    data,
    raw: payload,
  };
}

/**
 * Submit Card KYC (POST /api/cards/kyc).
 * Returns customer_id + normalized_status used for Standard Card issuance.
 * Docs: https://bitnob.dev/docs/card-issuing/card-kyc
 */
async function submitCardKyc(input = {}, { timeoutMs } = {}) {
  const customer = input.customer && typeof input.customer === 'object' ? input.customer : {};
  const firstName = String(customer.first_name || customer.firstName || '').trim();
  const lastName = String(customer.last_name || customer.lastName || '').trim();
  const email = String(customer.email || '').trim().toLowerCase();
  const idType = String(customer.id_type || customer.idType || '').trim().toLowerCase();
  const idNumber = String(customer.id_number || customer.idNumber || '').trim();
  const dob = String(customer.date_of_birth || customer.dateOfBirth || '').trim();

  if (!firstName || !lastName) {
    const err = new Error('customer.first_name and customer.last_name are required');
    err.code = 'BITNOB_KYC_NAME_REQUIRED';
    throw err;
  }
  if (!email) {
    const err = new Error('customer.email is required');
    err.code = 'BITNOB_KYC_EMAIL_REQUIRED';
    throw err;
  }
  if (!idType || !idNumber) {
    const err = new Error('customer.id_type and customer.id_number are required');
    err.code = 'BITNOB_KYC_ID_REQUIRED';
    throw err;
  }
  if (!dob) {
    const err = new Error('customer.date_of_birth is required (YYYY-MM-DD)');
    err.code = 'BITNOB_KYC_DOB_REQUIRED';
    throw err;
  }

  const body = {
    customer: {
      customer_type: String(customer.customer_type || customer.customerType || 'individual').trim().toLowerCase(),
      first_name: firstName,
      last_name: lastName,
      email,
      date_of_birth: dob,
      id_type: idType,
      id_number: idNumber,
      line1: String(customer.line1 || customer.address_line1 || '').trim(),
      line2: String(customer.line2 || customer.address_line2 || '').trim() || undefined,
      city: String(customer.city || '').trim(),
      state: String(customer.state || '').trim(),
      postal_code: String(customer.postal_code || customer.postalCode || '').trim(),
      country: String(customer.country || 'MMR').trim().toUpperCase(),
    },
    occupation: String(input.occupation || 'other').trim().toLowerCase(),
    employment_status: String(input.employment_status || input.employmentStatus || 'employed').trim().toLowerCase(),
    account_purpose: String(input.account_purpose || input.accountPurpose || 'payments').trim().toLowerCase(),
    annual_salary: String(input.annual_salary || input.annualSalary || '12000'),
    expected_monthly_volume: String(
      input.expected_monthly_volume || input.expectedMonthlyVolume || '500'
    ),
    terms_of_service_accepted: input.terms_of_service_accepted !== false
      && input.termsOfServiceAccepted !== false,
  };

  if (customer.phone_number || customer.phoneNumber) {
    body.customer.phone_number = String(customer.phone_number || customer.phoneNumber).trim();
  }
  if (customer.dial_code || customer.dialCode) {
    body.customer.dial_code = String(customer.dial_code || customer.dialCode).trim();
  }
  if (input.place_of_birth || input.placeOfBirth) {
    body.place_of_birth = String(input.place_of_birth || input.placeOfBirth).trim();
  }
  if (input.webhook_url || input.webhookUrl) {
    body.webhook_url = String(input.webhook_url || input.webhookUrl).trim();
  }
  if (input.redirect_url || input.redirectUrl) {
    body.redirect_url = String(input.redirect_url || input.redirectUrl).trim();
  }

  // Document ID types require a base64 front image; BVN/NIN must never include it.
  const needsImage = !['bvn', 'nin'].includes(idType);
  const frontImage = input.id_front_image || input.idFrontImage || null;
  if (needsImage) {
    if (!frontImage) {
      const err = new Error(`id_front_image is required for id_type=${idType}`);
      err.code = 'BITNOB_KYC_IMAGE_REQUIRED';
      throw err;
    }
    body.id_front_image = String(frontImage).replace(/^data:[^;]+;base64,/, '');
  }

  if (!body.customer.line1 || !body.customer.city || !body.customer.state || !body.customer.postal_code) {
    const err = new Error('customer address (line1, city, state, postal_code) is required');
    err.code = 'BITNOB_KYC_ADDRESS_REQUIRED';
    throw err;
  }
  if (!body.terms_of_service_accepted) {
    const err = new Error('Terms of service must be accepted');
    err.code = 'BITNOB_KYC_TOS_REQUIRED';
    throw err;
  }

  const { payload, data } = await bitnobRequest('/api/cards/kyc', {
    method: 'POST',
    body,
    timeoutMs,
  });

  const customerId = pick(
    data?.customer_id,
    data?.customerId,
    data?.customer?.id,
    data?.customer?.customer_id,
    payload?.customer_id,
    payload?.customerId
  );
  const normalizedStatus = String(
    pick(
      data?.normalized_status,
      data?.normalizedStatus,
      data?.status,
      payload?.normalized_status,
      'initiated'
    ) || 'initiated'
  ).toLowerCase();

  return {
    customer_id: customerId ? String(customerId) : null,
    normalized_status: normalizedStatus,
    status: pick(data?.status, payload?.status, normalizedStatus),
    completion_link: pick(data?.completion_link, data?.completionLink) || null,
    email: pick(data?.email, email),
    first_name: pick(data?.first_name, data?.firstName, firstName),
    last_name: pick(data?.last_name, data?.lastName, lastName),
    message: pick(data?.message, payload?.message) || null,
    data,
    raw: payload,
  };
}

/**
 * Poll Card KYC status for a customer (best-effort).
 * Prefer webhooks for terminal outcomes.
 */
async function getCardKycStatus(customerId, { timeoutMs } = {}) {
  const id = String(customerId || '').trim();
  if (!id) {
    const err = new Error('customerId is required');
    err.code = 'BITNOB_CUSTOMER_ID_REQUIRED';
    throw err;
  }

  const { payload, data } = await bitnobRequest(
    `/api/cards/kyc/${encodeURIComponent(id)}`,
    { method: 'GET', timeoutMs }
  );

  const normalizedStatus = String(
    pick(data?.normalized_status, data?.normalizedStatus, data?.status, 'none') || 'none'
  ).toLowerCase();

  return {
    customer_id: id,
    normalized_status: normalizedStatus,
    status: pick(data?.status, normalizedStatus),
    reason: pick(data?.reason) || null,
    completion_link: pick(data?.completion_link, data?.completionLink) || null,
    data,
    raw: payload,
  };
}

module.exports = {
  MICROUNITS_PER_UNIT,
  EGRESS_PROXY_KEY_HEADER,
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
  getBalances,
  getBalanceByCurrency,
  generateDepositAddress,
  submitCardKyc,
  getCardKycStatus,
};
