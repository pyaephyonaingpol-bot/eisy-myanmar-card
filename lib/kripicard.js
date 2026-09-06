/**
 * Kripicard virtual-card client.
 *
 * Real-time issue: POST /api/external/cards/createcard
 * Pool list (legacy): GET /v1/virtual-cards
 */

const DEFAULT_HOST = 'https://appapi.kripicard.com';
const DEFAULT_CREATE_CARD_URL = `${DEFAULT_HOST}/api/external/cards/createcard`;
const DEFAULT_BINS_URL = `${DEFAULT_HOST}/api/external/cards/bins`;
const DEFAULT_POOL_URL = `${DEFAULT_HOST}/v1/virtual-cards`;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MIN_AMOUNT = 1;

const INACTIVE_BIN_STATUSES = new Set([
  'inactive',
  'disabled',
  'maintenance',
  'maint',
  'unavailable',
  'offline',
  'down',
  'blocked',
  'suspended',
  'closed',
  'deprecated',
  'not_available',
  'not-available',
  'under_maintenance',
  'under-maintenance',
]);

function getKripicardConfig() {
  const apiKey = String(process.env.KRIPICARD_API_KEY || '').trim();
  const createCardUrl = String(
    process.env.KRIPICARD_CREATE_CARD_URL || DEFAULT_CREATE_CARD_URL
  ).trim();
  // Pool-list URL (admin fetch). Prefer explicit env, else legacy KRIPICARD_API_URL, else default.
  const baseUrl = String(
    process.env.KRIPICARD_POOL_URL
      || process.env.KRIPICARD_API_URL
      || DEFAULT_POOL_URL
  ).trim().replace(/\/$/, '');
  const timeoutMs = Number(process.env.KRIPICARD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const minAmount = Number(process.env.KRIPICARD_MIN_AMOUNT);
  const binsUrl = String(
    process.env.KRIPICARD_BINS_URL || DEFAULT_BINS_URL
  ).trim();
  return {
    apiKey,
    createCardUrl,
    binsUrl,
    baseUrl,
    timeoutMs,
    minAmount: Number.isFinite(minAmount) && minAmount > 0 ? minAmount : DEFAULT_MIN_AMOUNT,
  };
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

async function parseKripicardResponse(response) {
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
      (json && (json.message || json.error || json.msg || json.detail)) ||
      `Kripicard request failed with status ${response.status}`;
    const err = new Error(String(message));
    err.code = 'KRIPICARD_HTTP_ERROR';
    err.status = response.status;
    err.body = json;
    throw err;
  }

  // Some Kripicard endpoints return HTTP 200 with success:false
  if (json && typeof json === 'object' && json.success === false) {
    const message = json.message || json.error || json.msg || 'Kripicard reported failure';
    const err = new Error(String(message));
    err.code = 'KRIPICARD_API_ERROR';
    err.status = response.status;
    err.body = json;
    throw err;
  }

  return json;
}

async function kripicardRequest(url, { method = 'GET', body, timeoutMs } = {}) {
  const { apiKey, timeoutMs: defaultTimeout } = getKripicardConfig();
  assertApiKey(apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || defaultTimeout);

  try {
    const response = await fetch(url, {
      method,
      headers: buildAuthHeaders(apiKey),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return await parseKripicardResponse(response);
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(
        `Kripicard request timed out after ${timeoutMs || defaultTimeout}ms`
      );
      timeoutErr.code = 'KRIPICARD_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Direct Kripicard card creation.
 *
 * POST {KRIPICARD_CREATE_CARD_URL}
 *   default: https://appapi.kripicard.com/api/external/cards/createcard
 *
 * Authorization headers (buildAuthHeaders):
 *   Authorization: Bearer <KRIPICARD_API_KEY>
 *   X-API-Key: <KRIPICARD_API_KEY>
 *   Content-Type: application/json
 *
 * JSON body:
 *   { api_key, name_on_card, bin, amount }
 *
 * Returns normalized card details (card_id, card_number, cvv, exp_date, …)
 * plus the raw provider response for persistence.
 */
async function createExternalCard({
  nameOnCard,
  bin,
  amount,
  extra = {},
  timeoutMs,
} = {}) {
  const { apiKey, createCardUrl, minAmount } = getKripicardConfig();
  assertApiKey(apiKey);

  const name = String(nameOnCard || '').trim();
  const binValue = String(bin || '').trim();
  const amountNum = Number(amount);

  if (name.length < 2) {
    const err = new Error('name_on_card must be at least 2 characters');
    err.code = 'INVALID_NAME_ON_CARD';
    throw err;
  }
  if (!binValue) {
    const err = new Error('bin is required');
    err.code = 'INVALID_BIN';
    throw err;
  }
  if (!Number.isFinite(amountNum) || amountNum < minAmount) {
    const err = new Error(`amount must be a number >= ${minAmount}`);
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const requestBody = {
    api_key: apiKey,
    name_on_card: name,
    bin: /^\d+$/.test(binValue) ? Number(binValue) : binValue,
    amount: amountNum,
    ...extra,
  };

  const raw = await kripicardRequest(createCardUrl, {
    method: 'POST',
    body: requestBody,
    timeoutMs,
  });

  // Response may nest card under data / card / details
  const cardPayload =
    (raw && raw.data && (raw.data.card || raw.data.details || raw.data)) ||
    (raw && (raw.card || raw.details)) ||
    raw;

  const normalized = normalizePoolCard(
    {
      ...(typeof cardPayload === 'object' && cardPayload ? cardPayload : {}),
      // Prefer explicit top-level ids when nested payload omits them
      card_id: pick(
        cardPayload && cardPayload.card_id,
        cardPayload && cardPayload.cardId,
        cardPayload && cardPayload.id,
        raw && raw.card_id,
        raw && raw.cardId,
        raw && raw.id
      ),
      bin: pick(cardPayload && cardPayload.bin, binValue),
      cardholder_name: pick(
        cardPayload && cardPayload.cardholder_name,
        cardPayload && cardPayload.name_on_card,
        name
      ),
      balance: pick(
        cardPayload && cardPayload.balance,
        cardPayload && cardPayload.amount,
        amountNum
      ),
    },
    { provider: 'kripicard' }
  );

  if (!normalized || !normalized.card_id) {
    const err = new Error('Kripicard createcard succeeded but returned no card_id');
    err.code = 'KRIPICARD_MISSING_CARD_ID';
    err.body = raw;
    throw err;
  }

  return {
    card: normalized,
    raw,
    request: {
      name_on_card: name,
      bin: binValue,
      amount: amountNum,
    },
  };
}

async function fetchVirtualCards(options = {}) {
  const { baseUrl } = getKripicardConfig();

  const url = new URL(options.path ? `${baseUrl}${options.path}` : baseUrl);
  const query = options.query || {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const raw = await kripicardRequest(url.toString(), {
    method: options.method || 'GET',
    body: options.body,
    timeoutMs: options.timeoutMs,
  });

  const list = unwrapCardList(raw);
  const cards = list
    .map((item) => normalizePoolCard(item))
    .filter(Boolean);

  return {
    cards,
    raw,
    count: cards.length,
    skipped: list.length - cards.length,
  };
}

/**
 * Whether a provider BIN entry is currently issuable (not maintenance/inactive).
 */
function isActiveBinEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;

  const flagKeys = [
    'available',
    'is_available',
    'isAvailable',
    'enabled',
    'is_enabled',
    'isEnabled',
    'active',
    'is_active',
    'isActive',
    'issuable',
    'can_issue',
    'canIssue',
  ];
  for (const key of flagKeys) {
    if (entry[key] === undefined || entry[key] === null) continue;
    const value = entry[key];
    if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') {
      return false;
    }
    if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') {
      return true;
    }
  }

  if (entry.maintenance === true || entry.in_maintenance === true || entry.under_maintenance === true) {
    return false;
  }

  const status = pick(
    entry.status,
    entry.state,
    entry.availability,
    entry.bin_status,
    entry.binStatus,
    entry.card_status,
    entry.lifecycle
  );
  if (status == null || status === '') return true;

  const normalized = String(status).trim().toLowerCase().replace(/\s+/g, '_');
  if (INACTIVE_BIN_STATUSES.has(normalized)) return false;
  if (
    normalized.includes('maintenance')
    || normalized.includes('inactive')
    || normalized.includes('unavailable')
    || normalized.includes('disabled')
  ) {
    return false;
  }
  return true;
}

function unwrapBinList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.bins)) return payload.bins;
  if (Array.isArray(payload.bank_bins)) return payload.bank_bins;
  if (Array.isArray(payload.available_bins)) return payload.available_bins;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.data && Array.isArray(payload.data.bins)) return payload.data.bins;
  if (payload.data && Array.isArray(payload.data.bank_bins)) return payload.data.bank_bins;
  if (payload.data && Array.isArray(payload.data.available_bins)) return payload.data.available_bins;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const nested = unwrapBinList(payload.data);
    if (nested.length) return nested;
  }
  return [];
}

function normalizeBinEntry(raw) {
  if (raw == null) return null;

  if (typeof raw === 'number' || typeof raw === 'string') {
    const bin = String(raw).trim();
    if (!/^\d{4,8}$/.test(bin)) return null;
    return { bin, status: 'active', label: bin, raw };
  }

  if (typeof raw !== 'object') return null;

  const binValue = pick(
    raw.bin,
    raw.bank_bin,
    raw.bankBin,
    raw.bin_code,
    raw.binCode,
    raw.code,
    raw.value,
    raw.card_bin,
    raw.cardBin
  );
  if (binValue == null) return null;
  const bin = String(binValue).trim();
  if (!/^\d{4,8}$/.test(bin)) return null;

  const status = pick(
    raw.status,
    raw.state,
    raw.availability,
    raw.bin_status,
    raw.binStatus
  );
  const label = pick(raw.label, raw.name, raw.title, raw.description, bin);

  return {
    bin,
    status: status != null ? String(status) : 'active',
    label: label != null ? String(label) : bin,
    brand: pick(raw.brand, raw.network, raw.scheme, raw.card_brand) || null,
    // Preserve availability flags so isActiveBinEntry can filter maintenance/inactive BINs.
    available: raw.available,
    is_available: raw.is_available,
    isAvailable: raw.isAvailable,
    enabled: raw.enabled,
    is_enabled: raw.is_enabled,
    isEnabled: raw.isEnabled,
    active: raw.active,
    is_active: raw.is_active,
    isActive: raw.isActive,
    issuable: raw.issuable,
    can_issue: raw.can_issue,
    canIssue: raw.canIssue,
    maintenance: raw.maintenance,
    in_maintenance: raw.in_maintenance,
    under_maintenance: raw.under_maintenance,
    raw,
  };
}

/**
 * Fetch currently available BINs from Kripicard.
 *
 * GET/POST {KRIPICARD_BINS_URL}
 *   default: https://appapi.kripicard.com/api/external/cards/bins
 *
 * Filters out maintenance / inactive BINs so the Apply Card dropdown only
 * shows issuable options that match Kripicard's live catalog.
 */
async function fetchAvailableBins({ timeoutMs } = {}) {
  const { apiKey, binsUrl } = getKripicardConfig();
  assertApiKey(apiKey);

  let raw;
  let lastError = null;

  // Prefer GET with api_key query (provider accepts query auth on this route).
  try {
    const url = new URL(binsUrl);
    url.searchParams.set('api_key', apiKey);
    raw = await kripicardRequest(url.toString(), {
      method: 'GET',
      timeoutMs,
    });
  } catch (err) {
    lastError = err;
  }

  // Fallback: POST body shaped like createcard ({ api_key }).
  if (raw == null) {
    try {
      raw = await kripicardRequest(binsUrl, {
        method: 'POST',
        body: { api_key: apiKey },
        timeoutMs,
      });
    } catch (err) {
      throw lastError || err;
    }
  }

  const list = unwrapBinList(raw);
  const normalized = list.map(normalizeBinEntry).filter(Boolean);
  const active = normalized.filter(isActiveBinEntry);

  const seen = new Set();
  const bins = [];
  for (const entry of active) {
    if (seen.has(entry.bin)) continue;
    seen.add(entry.bin);
    bins.push(entry.bin);
  }

  return {
    bins,
    details: active,
    inactive_count: normalized.length - active.length,
    raw,
    count: bins.length,
  };
}


module.exports = {
  DEFAULT_BASE_URL: DEFAULT_POOL_URL,
  DEFAULT_CREATE_CARD_URL,
  DEFAULT_BINS_URL,
  DEFAULT_POOL_URL,
  getKripicardConfig,
  fetchVirtualCards,
  fetchAvailableBins,
  createExternalCard,
  normalizePoolCard,
  unwrapCardList,
  unwrapBinList,
  normalizeBinEntry,
  isActiveBinEntry,
  buildAuthHeaders,
  kripicardRequest,
};
