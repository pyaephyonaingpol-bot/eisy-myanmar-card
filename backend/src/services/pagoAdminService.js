const User = require('../models/User');
const Card = require('../models/Card');
const { loadPagoCardClient } = require('./loadPagoCardClient');
const { mapPagoStatus } = require('./pagoCardService');

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function getClient(deps = {}) {
  if (deps.client) return deps.client;
  const timeoutMs = Number(deps.timeoutMs) || 15000;
  return loadPagoCardClient().createPagoCardClient({ timeoutMs });
}

function rethrowPago(err) {
  const code = err?.code || 'PAGO_ERROR';
  if (code === 'PAGO_TIMEOUT') {
    throw httpError('Pagocards admin API timed out. Please try again.', 504, 'PAGO_TIMEOUT');
  }
  if (code === 'PAGO_NOT_CONFIGURED') {
    throw httpError(err.message, 503, code);
  }
  const status = Number(err?.status);
  throw httpError(
    err.message || 'Pagocards admin request failed',
    status >= 400 && status < 500 ? status : 502,
    code
  );
}

function readDisplayBalance(row) {
  if (!row || typeof row !== 'object') return null;
  const balance = row.balance;
  if (balance && balance.display_amount != null) {
    const n = Number(balance.display_amount);
    return Number.isFinite(n) ? n : null;
  }
  if (row.display_amount != null) {
    const n = Number(row.display_amount);
    return Number.isFinite(n) ? n : null;
  }
  if (row.balance_usd != null) {
    const n = Number(row.balance_usd);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeAdminCardRow(row) {
  const item = row && typeof row === 'object' ? row : {};
  const pagoCardId = String(item.card_id || item.cardid || item.id || '').trim();
  const email = String(item.email || item.useremail || item.user_email || '').trim();
  const brand = String(item.brand || item.card_brand || '').trim();
  const statusRaw = item.status || item.card_status || item.pago_status || '';
  const status = mapPagoStatus(statusRaw);
  return {
    pago_card_id: pagoCardId || null,
    email: email || null,
    brand: brand || null,
    product_code: item.product_code || item.productCode || null,
    status,
    pago_status: statusRaw || null,
    last_four: String(item.last_four || item.lastfour || '').replace(/\D/g, '').slice(-4) || null,
    balance_usd: readDisplayBalance(item),
    name_on_card: item.name_on_card || item.cardholder_name || item.name || null,
    created_at: item.created_at || item.createdAt || null,
    raw: item,
  };
}

function extractCardList(payload) {
  if (!payload || typeof payload !== 'object') return { cards: [], meta: {} };
  const root = payload;
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const cards = Array.isArray(data.cards)
    ? data.cards
    : (Array.isArray(data.data) ? data.data : (Array.isArray(root.cards) ? root.cards : []));
  const meta = {
    page: data.page ?? data.current_page ?? root.page ?? null,
    per_page: data.per_page ?? data.perPage ?? root.per_page ?? null,
    total: data.total ?? data.total_count ?? root.total ?? null,
    last_page: data.last_page ?? data.lastPage ?? root.last_page ?? null,
  };
  return { cards, meta };
}

function extractRowList(payload, keys = ['transactions', 'deposits', 'items', 'rows']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

async function enrichAdminCards(rows) {
  const out = [];
  for (const row of rows) {
    const normalized = normalizeAdminCardRow(row);
    let local = normalized.pago_card_id
      ? await Card.findByPagoCardId(normalized.pago_card_id)
      : null;
    let user = null;
    if (local?.user_id) user = await User.findById(local.user_id);
    if (!user && normalized.email) {
      user = await User.findByEmail(normalized.email);
    }
    out.push({
      ...normalized,
      local_card_id: local?.id || null,
      local_user_id: user?.id || local?.user_id || null,
      user_name: user?.name || local?.card_holder_name || normalized.name_on_card || null,
      user_email: user?.email || normalized.email || null,
    });
  }
  return out;
}

async function fetchPagoAdminBalance(deps = {}) {
  const client = getClient(deps);
  if (typeof client.getAdminBalance !== 'function') {
    throw httpError('Pagocards admin balance is unavailable', 503, 'PAGO_NOT_CONFIGURED');
  }
  try {
    return await client.getAdminBalance();
  } catch (err) {
    rethrowPago(err);
  }
}

async function fetchPagoAdminAllCards({ brand = 'visa', perPage = 20, page = 1, email = '' } = {}, deps = {}) {
  const client = getClient(deps);
  if (typeof client.listAdminAllCards !== 'function') {
    throw httpError('Pagocards admin card list is unavailable', 503, 'PAGO_NOT_CONFIGURED');
  }
  let payload;
  try {
    payload = await client.listAdminAllCards({
      brand: String(brand || 'visa').trim() || 'visa',
      per_page: perPage,
      page,
    });
  } catch (err) {
    rethrowPago(err);
  }
  const { cards: rawCards, meta } = extractCardList(payload);
  let enriched = await enrichAdminCards(rawCards);
  const emailNeedle = String(email || '').trim().toLowerCase();
  if (emailNeedle) {
    enriched = enriched.filter((row) => {
      const hay = `${row.user_email || ''} ${row.email || ''} ${row.user_name || ''}`.toLowerCase();
      return hay.includes(emailNeedle);
    });
  }
  return { cards: enriched, meta, provider: payload };
}

async function fetchPagoAdminTransactions(query = {}, deps = {}) {
  const client = getClient(deps);
  if (typeof client.listAdminTransactions !== 'function') {
    throw httpError('Pagocards admin transactions are unavailable', 503, 'PAGO_NOT_CONFIGURED');
  }
  try {
    const payload = await client.listAdminTransactions(query);
    return {
      transactions: extractRowList(payload, ['transactions', 'items', 'rows']),
      provider: payload,
    };
  } catch (err) {
    rethrowPago(err);
  }
}

async function fetchPagoAdminDeposits(query = {}, deps = {}) {
  const client = getClient(deps);
  if (typeof client.listAdminDeposits !== 'function') {
    throw httpError('Pagocards admin deposits are unavailable', 503, 'PAGO_NOT_CONFIGURED');
  }
  try {
    const payload = await client.listAdminDeposits(query);
    return {
      deposits: extractRowList(payload, ['deposits', 'items', 'rows']),
      provider: payload,
    };
  } catch (err) {
    rethrowPago(err);
  }
}

module.exports = {
  fetchPagoAdminBalance,
  fetchPagoAdminAllCards,
  fetchPagoAdminTransactions,
  fetchPagoAdminDeposits,
  normalizeAdminCardRow,
};
