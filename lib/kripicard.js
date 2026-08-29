/**
 * Kripicard virtual-card client (Pool Model source).
 * Docs / base: https://appapi.kripicard.com/v1/virtual-cards
 */

const DEFAULT_BASE_URL = 'https://appapi.kripicard.com/v1/virtual-cards';
const DEFAULT_TIMEOUT_MS = 30000;

function getKripicardConfig() {
  const apiKey = String(process.env.KRIPICARD_API_KEY || '').trim();
  const baseUrl = String(
    process.env.KRIPICARD_API_URL || DEFAULT_BASE_URL
  ).trim().replace(/\/$/, '');
  const timeoutMs = Number(process.env.KRIPICARD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  return { apiKey, baseUrl, timeoutMs };
}

function assertApiKey(apiKey) {
  if (!apiKey || apiKey.includes('...')) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Build auth headers. Prefer Authorization Bearer; also send X-API-Key for
 * providers that expect a dedicated header.
 */
function buildAuthHeaders(apiKey) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
  };

  const customHeader = String(process.env.KRIPICARD_API_KEY_HEADER || '').trim();
  if (customHeader) {
    headers[customHeader] = apiKey;
  }

  return headers;
}

function unwrapCardList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.cards)) return payload.cards;
  if (Array.isArray(payload.virtual_cards)) return payload.virtual_cards;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.data && Array.isArray(payload.data.cards)) return payload.data.cards;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    // Single card object wrapped in data
    return [payload.data];
  }
  if (typeof payload === 'object' && (payload.card_id || payload.cardId || payload.id)) {
    return [payload];
  }
  return [];
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const asString = typeof value === 'string' ? value.trim() : value;
    if (asString === '') continue;
    return value;
  }
  return null;
}

function normalizeExpDate(raw) {
  const direct = pick(raw.exp_date, raw.expiry, raw.expiration, raw.expDate, raw.expire_date);
  if (direct) return String(direct);

  const month = pick(raw.exp_month, raw.expiry_month, raw.expMonth, raw.month);
  const year = pick(raw.exp_year, raw.expiry_year, raw.expYear, raw.year);
  if (month && year) {
    const mm = String(month).padStart(2, '0');
    const yy = String(year).slice(-2);
    return `${mm}/${yy}`;
  }
  return null;
}

/**
 * Map a provider card payload into a card_pools row shape.
 */
function normalizePoolCard(raw, { provider = 'kripicard' } = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const cardId = pick(
    raw.card_id,
    raw.cardId,
    raw.id,
    raw.virtual_card_id,
    raw.vc_id
  );
  if (!cardId) return null;

  const expMonth = pick(raw.exp_month, raw.expiry_month, raw.expMonth, raw.month);
  const expYear = pick(raw.exp_year, raw.expiry_year, raw.expYear, raw.year);

  return {
    card_id: String(cardId),
    card_number: pick(raw.card_number, raw.cardNumber, raw.pan, raw.number)
      ? String(pick(raw.card_number, raw.cardNumber, raw.pan, raw.number))
      : null,
    cvv: pick(raw.cvv, raw.cvc, raw.security_code)
      ? String(pick(raw.cvv, raw.cvc, raw.security_code))
      : null,
    exp_date: normalizeExpDate(raw),
    exp_month: expMonth != null ? String(expMonth).padStart(2, '0') : null,
    exp_year: expYear != null ? String(expYear) : null,
    cardholder_name: pick(
      raw.cardholder_name,
      raw.card_holder_name,
      raw.holder_name,
      raw.name,
      [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim() || null
    ),
    brand: pick(raw.brand, raw.network, raw.scheme, raw.card_brand),
    bin: pick(raw.bin, raw.bank_bin, raw.bankBin)
      ? String(pick(raw.bin, raw.bank_bin, raw.bankBin))
      : null,
    currency: String(pick(raw.currency, raw.currency_code, 'USD')).toUpperCase(),
    balance: Number(pick(raw.balance, raw.available_balance, raw.amount, 0)) || 0,
    provider,
    raw_payload: raw,
  };
}

async function fetchVirtualCards(options = {}) {
  const { apiKey, baseUrl, timeoutMs } = getKripicardConfig();
  assertApiKey(apiKey);

  const url = new URL(options.path ? `${baseUrl}${options.path}` : baseUrl);
  const query = options.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers: buildAuthHeaders(apiKey),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      const err = new Error(`Kripicard returned non-JSON response (${response.status})`);
      err.code = 'KRIPICARD_BAD_RESPONSE';
      err.status = response.status;
      err.body = text.slice(0, 500);
      throw err;
    }

    if (!response.ok) {
      const message =
        (json && (json.message || json.error || json.msg)) ||
        `Kripicard request failed with status ${response.status}`;
      const err = new Error(String(message));
      err.code = 'KRIPICARD_HTTP_ERROR';
      err.status = response.status;
      err.body = json;
      throw err;
    }

    const list = unwrapCardList(json);
    const cards = list
      .map((item) => normalizePoolCard(item))
      .filter(Boolean);

    return {
      cards,
      raw: json,
      count: cards.length,
      skipped: list.length - cards.length,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Kripicard request timed out after ${options.timeoutMs || timeoutMs}ms`);
      timeoutErr.code = 'KRIPICARD_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  getKripicardConfig,
  fetchVirtualCards,
  normalizePoolCard,
  unwrapCardList,
  buildAuthHeaders,
};
