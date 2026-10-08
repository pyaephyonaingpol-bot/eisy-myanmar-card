const crypto = require('crypto');
const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const { debitUsdt, creditUsdt } = require('./walletService');
const {
  getCardPricingSettings,
  calculateCardReloadPricingUsdt,
} = require('./settingsService');
const { loadPagoCardClient } = require('./loadPagoCardClient');
const { displayStatusLabel } = require('../constants/cardStatuses');
const { quoteCardIssuanceCheckout } = require('../constants/cardIssuanceFees');

const PAGO_PRODUCTS = [
  { code: 'us_493_visa_bin_v2', label: 'Visa (493)', allows_initial_load: true },
  { code: 'us_404_visa_bin', label: 'Visa (404)', allows_initial_load: true },
  { code: 'us_493_visa_atm', label: 'Visa ATM', allows_initial_load: false },
  { code: '536_master', label: 'Mastercard', allows_initial_load: true },
];

const PRODUCT_CODES = new Set(PAGO_PRODUCTS.map((item) => item.code));
/** New cards are always issued on Visa BIN 404. The request form does not offer a BIN choice. */
const DEFAULT_ISSUE_PRODUCT = 'us_404_visa_bin';
const ATM_PRODUCT_CODE = 'us_493_visa_atm';
const MIN_INITIAL_LOAD = 10;
const MAX_INITIAL_LOAD = 2500;
const MIN_TOP_UP = 5;
/** Upstream create call. The route backstop is a few seconds longer so a timeout can refund. */
const CARD_CREATE_TIMEOUT_MS = parseInt(process.env.CARD_CREATE_TIMEOUT_MS || '15000', 10);
const CARD_CREATE_ROUTE_TIMEOUT_MS = parseInt(process.env.CARD_CREATE_ROUTE_TIMEOUT_MS || '22000', 10);
/** One card details / list call. */
const CARD_FETCH_TIMEOUT_MS = parseInt(process.env.CARD_FETCH_TIMEOUT_MS || '8000', 10);
/** Whole provider sync while loading My Cards. */
const CARD_SYNC_BUDGET_MS = parseInt(process.env.CARD_SYNC_BUDGET_MS || '12000', 10);

function withCardApiTimeout(promise, ms, label = 'Card request') {
  const timeoutMs = Math.max(1000, Number(ms) || CARD_FETCH_TIMEOUT_MS);
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(httpError(
        `${label} timed out. Please try again.`,
        504,
        'CARD_REQUEST_TIMEOUT'
      ));
    }, timeoutMs);
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

function isCardTimeoutError(err) {
  const code = String(err?.code || '');
  return code === 'PAGO_TIMEOUT' || code === 'CARD_REQUEST_TIMEOUT';
}

function truncateUsd(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  return sign * (Math.trunc(Math.abs(value) * 100) / 100);
}

function httpError(message, status, code, extra) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

function mapPagoStatus(raw) {
  const status = String(raw || '').toLowerCase().trim();
  // Create responses use "active"; Get Card uses Pagocards lifecycle names.
  if (['active', 'activated', 'enabled', 'open', 'normal'].includes(status)) return 'active';
  if ([
    'pending',
    'processing',
    'creating',
    'issued',
    'initial_state',
    'pending_activation',
    'activation_in_progress',
  ].includes(status)) return 'pending';
  if (['frozen', 'freeze', 'blocked', 'inactive', 'suspended', 'pause'].includes(status)) {
    return 'frozen';
  }
  if ([
    'terminated',
    'cancelled',
    'canceled',
    'closed',
    'expired',
    'loss_report',
    'before_cancellation',
    'cancellation',
  ].includes(status)) return 'terminated';
  return status ? 'pending' : 'active';
}

function splitName(firstName, lastName, fallback) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (first && last) return { first_name: first, last_name: last };
  const parts = String(fallback || '').trim().split(/\s+/).filter(Boolean);
  if (!first && parts.length >= 2) {
    return { first_name: parts[0], last_name: last || parts.slice(1).join(' ') };
  }
  if (!first && parts.length === 1) {
    return { first_name: parts[0], last_name: last || parts[0] };
  }
  if (first && !last) return { first_name: first, last_name: first };
  throw httpError('First name and last name are required', 400, 'VALIDATION_ERROR');
}

function readBalance(card) {
  const balance = card?.balance || {};
  const display = balance.display_amount != null ? Number(balance.display_amount) : null;
  return {
    balance_display_usd: Number.isFinite(display) ? display : null,
    balance_amount: balance.amount != null && Number.isFinite(Number(balance.amount))
      ? Number(balance.amount)
      : null,
    balance_currency: balance.currency || card?.currency || 'USD',
  };
}

function parseExpiryParts(card) {
  let expiryMonth = card?.expiry_month != null ? String(card.expiry_month).trim() : '';
  let expiryYear = card?.expiry_year != null ? String(card.expiry_year).trim() : '';
  const expiredate = String(card?.expiredate || card?.expire_date || '').trim();
  if ((!expiryMonth || !expiryYear) && expiredate) {
    const match = expiredate.match(/^(\d{1,2})\s*[\/\-]\s*(\d{2,4})$/);
    if (match) {
      if (!expiryMonth) expiryMonth = match[1].padStart(2, '0');
      if (!expiryYear) expiryYear = match[2];
    }
  }
  if (expiryMonth) expiryMonth = expiryMonth.padStart(2, '0');
  if (expiryYear && expiryYear.length === 4) expiryYear = expiryYear.slice(-2);
  const expDate = expiredate
    || [expiryMonth, expiryYear].filter(Boolean).join('/')
    || null;
  return {
    expiryMonth: expiryMonth || null,
    expiryYear: expiryYear || null,
    expDate,
  };
}

function cardFieldsFromProvider(card) {
  const balance = readBalance(card);
  const number = card.card_number || card.cardnumber || null;
  const digits = String(number || '').replace(/\D/g, '');
  const lastFour = String(card.last_four || card.lastfour || digits.slice(-4) || '')
    .replace(/\D/g, '')
    .slice(-4);
  const { expiryMonth, expiryYear, expDate } = parseExpiryParts(card);
  const cvv = card.cvv != null && String(card.cvv).trim() !== ''
    ? String(card.cvv).replace(/\D/g, '')
    : null;
  return {
    pagoCardId: String(card.card_id || card.cardid || '').trim(),
    productCode: card.product_code || null,
    brand: card.brand || null,
    status: mapPagoStatus(card.status),
    pagoStatus: card.status || null,
    cardNumber: digits || null,
    expDate,
    cvv: cvv || null,
    cardHolderName: card.name_on_card || null,
    lastFour,
    expiryMonth,
    expiryYear,
    email: card.email || null,
    balanceDisplayUsd: balance.balance_display_usd,
    balanceAmount: balance.balance_amount,
    balanceCurrency: balance.balance_currency,
  };
}

function needsSensitiveDetails(card) {
  const number = String(card?.card_number || card?.cardnumber || '').replace(/\D/g, '');
  const cvv = String(card?.cvv || '').replace(/\D/g, '');
  return number.length < 12 || cvv.length < 3;
}

async function enrichCreatedCard(created, deps = {}) {
  if (!created || !needsSensitiveDetails(created)) return created;
  const cardId = String(created.card_id || created.cardid || '').trim();
  if (!cardId) return created;
  try {
    const details = await getClient(deps).getCardDetails(cardId);
    return { ...created, ...details, card_id: details.card_id || cardId };
  } catch (err) {
    console.warn('[pago] getCardDetails after create skipped:', err.message);
    return created;
  }
}

function getClient(deps = {}) {
  if (deps.client) return deps.client;
  const timeoutMs = Number(deps.timeoutMs) || CARD_FETCH_TIMEOUT_MS;
  return loadPagoCardClient().createPagoCardClient({ timeoutMs });
}

function rethrowPago(err) {
  const code = err?.code || 'PAGO_ERROR';
  if (code === 'PAGO_TIMEOUT' || isCardTimeoutError(err)) {
    throw httpError('Pago Card timed out. Please try again.', 504, 'PAGO_TIMEOUT');
  }
  if (code === 'PAGO_NOT_CONFIGURED') {
    throw httpError(err.message, 503, code);
  }
  if (code === 'VALIDATION_ERROR') {
    throw httpError(err.message, 400, code);
  }
  const status = Number(err?.status);
  throw httpError(err.message || 'Pago Card request failed', status >= 400 && status < 500 ? status : 502, code);
}

async function refundUsdt(userId, amount, description) {
  if (!(Number(amount) > 0)) return;
  await creditUsdt(userId, amount, {
    txType: 'balance_credit',
    description,
    referenceType: 'cards_v2',
    createdBy: 'system',
    metadata: { provider: 'pago', refund: true },
  });
}

async function issuePagoCardForUser({
  userId,
  productCode,
  firstName,
  lastName,
  email,
  initialLoad,
}, deps = {}) {
  const product = String(productCode || '').trim();
  if (!PRODUCT_CODES.has(product)) {
    throw httpError('Choose a Pago Card product', 400, 'VALIDATION_ERROR');
  }
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404, 'USER_NOT_FOUND');

  const names = splitName(firstName, lastName, user.name);
  const cardEmail = String(email || user.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cardEmail)) {
    throw httpError('A valid email is required', 400, 'VALIDATION_ERROR');
  }

  let load = null;
  if (initialLoad != null && String(initialLoad).trim() !== '') {
    load = truncateUsd(initialLoad);
    if (product === ATM_PRODUCT_CODE) {
      throw httpError('Visa ATM cards do not take a starting balance', 400, 'VALIDATION_ERROR');
    }
    if (!Number.isFinite(load) || load < MIN_INITIAL_LOAD || load > MAX_INITIAL_LOAD) {
      throw httpError(
        `Starting balance must be between ${MIN_INITIAL_LOAD} and ${MAX_INITIAL_LOAD} USD`,
        400,
        'VALIDATION_ERROR'
      );
    }
  }

  const settings = deps.settings || await getCardPricingSettings();
  const pricing = quoteCardIssuanceCheckout({
    initialLoadUsd: load || 0,
    settings,
  });

  let debited = 0;
  if (pricing.total_usd > 0) {
    const fresh = await User.findById(userId);
    const available = Number(fresh?.balance_usdt || 0);
    if (!(available + 1e-9 >= pricing.total_usd)) {
      throw httpError('Insufficient balance', 400, 'INSUFFICIENT_USDT_BALANCE');
    }
    try {
      await debitUsdt(userId, pricing.total_usd, {
        txType: 'balance_debit',
        description: `Pago Card checkout ${pricing.total_usd.toFixed(2)} USD`,
        referenceType: 'cards_v2',
        createdBy: 'user',
        metadata: { provider: 'pago', product_code: product, ...pricing },
      });
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_USDT_BALANCE') {
        throw httpError('Insufficient balance', 400, 'INSUFFICIENT_USDT_BALANCE');
      }
      throw err;
    }
    debited = pricing.total_usd;
  }

  let created;
  try {
    created = await getClient({
      ...deps,
      timeoutMs: deps.timeoutMs || CARD_CREATE_TIMEOUT_MS,
    }).createVirtualCard({
      product_code: product,
      first_name: names.first_name,
      last_name: names.last_name,
      email: cardEmail,
      initial_load: load == null ? undefined : load,
      idempotencyKey: `pago-issue-${userId}-${crypto.randomBytes(8).toString('hex')}`,
    });
  } catch (err) {
    if (debited > 0) {
      await refundUsdt(userId, debited, 'Refund Pago Card checkout');
    }
    rethrowPago(err);
  }

  // Create often returns card_number/cvv null; Get Card fills PAN/CVV/expiry.
  created = await enrichCreatedCard(created, {
    ...deps,
    timeoutMs: CARD_FETCH_TIMEOUT_MS,
  });

  const fields = cardFieldsFromProvider(created);
  if (!fields.pagoCardId) {
    throw httpError('Pago Card did not return a card id', 502, 'PAGO_BAD_RESPONSE');
  }

  let row;
  try {
    row = await savePagoCardLocally({
      userId,
      fields,
      cardEmail,
      cardHolderName: fields.cardHolderName || `${names.first_name} ${names.last_name}`,
    });
  } catch (err) {
    console.error('[pago] local cards_v2 save failed:', err.message, {
      pago_card_id: fields.pagoCardId,
      last_four: fields.lastFour,
      has_pan: Boolean(fields.cardNumber),
      has_cvv: Boolean(fields.cvv),
    });
    // Last resort: re-fetch by id and try one more save (covers orphaned provider creates).
    try {
      row = await importPagoCardById(userId, fields.pagoCardId, {
        ...deps,
        email: cardEmail,
        productCode: product,
        cardHolderName: fields.cardHolderName || `${names.first_name} ${names.last_name}`,
      });
    } catch (importErr) {
      const wrapped = httpError(
        'The card was created at Pago Card but could not be saved locally',
        500,
        'PAGO_CARD_SAVE_FAILED'
      );
      wrapped.pago_card_id = fields.pagoCardId;
      wrapped.detail = String(err.message || err);
      wrapped.import_detail = String(importErr.message || importErr);
      throw wrapped;
    }
  }

  await TransactionLog.create({
    userId,
    type: 'card_issued',
    description: `Pago Card issued (${fields.lastFour ? `•••• ${fields.lastFour}` : fields.pagoCardId})`,
    referenceType: 'cards_v2',
    referenceId: row?.id || null,
    metadata: {
      provider: 'pago',
      pago_card_id: fields.pagoCardId,
      product_code: product,
      initial_load: load,
    },
    createdBy: 'user',
  }).catch((err) => console.warn('[pago] issue log skipped:', err.message));

  const platformFee = Math.round((
    pricing.card_issuance_fee_usd
    + pricing.card_processing_fee_usd
    + pricing.funding_fee_usd
  ) * 100) / 100;
  if (platformFee > 0) {
    try {
      const { recordPlatformUsdFee, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
      await recordPlatformUsdFee(platformFee, {
        feeType: PLATFORM_FEE_TYPES.CARD_ISSUE,
        description: `Card issuing fee — ${fields.lastFour ? `•••• ${fields.lastFour}` : fields.pagoCardId}`,
        referenceType: 'cards_v2',
        referenceId: row?.id || null,
        relatedUserId: userId,
        createdBy: 'user',
        metadata: { provider: 'pago', product_code: product, ...pricing },
      });
    } catch (err) {
      console.warn('[pago] issue fee ledger skipped:', err.message);
    }
  }

  return { card: row, debited_usdt: debited, pricing };
}

async function ensurePagoSchemaColumns() {
  try {
    const { getDb } = require('../db');
    const { columnExists, tableExists } = require('../../migrations/runner');
    const { ensurePagoCardColumns } = require('../../migrations/patches/ensurePagoCardColumns');
    await ensurePagoCardColumns(getDb(), columnExists, tableExists);
  } catch (err) {
    console.warn('[pago] ensurePagoCardColumns skipped:', err.message);
  }
}

async function savePagoCardLocally({ userId, fields, cardEmail, cardHolderName }) {
  const payload = {
    userId,
    ...fields,
    cardHolderName: cardHolderName || fields.cardHolderName || 'Card Holder',
    email: cardEmail,
  };
  try {
    return await Card.createFromPago(payload);
  } catch (err) {
    await ensurePagoSchemaColumns();
    return Card.createFromPago(payload);
  }
}

/**
 * Import one provider card into cards_v2 (idempotent by pago_card_id).
 * Used after orphaned creates and by the sync endpoint.
 */
async function importPagoCardById(userId, pagoCardId, deps = {}) {
  const id = String(pagoCardId || '').trim();
  if (!id) throw httpError('pago_card_id is required', 400, 'VALIDATION_ERROR');

  const existing = await Card.findByPagoCardId(id);
  if (existing && Number(existing.user_id) === Number(userId)) {
    try {
      const remote = await getClient({
        ...deps,
        timeoutMs: deps.timeoutMs || CARD_FETCH_TIMEOUT_MS,
      }).getCardDetails(id);
      return Card.updateFromPago(existing.id, cardFieldsFromProvider(remote));
    } catch (_) {
      return existing;
    }
  }
  if (existing && Number(existing.user_id) !== Number(userId)) {
    throw httpError('This card is already linked to another account', 409, 'PAGO_CARD_OWNED');
  }

  const user = await User.findById(userId);
  let remote;
  try {
    remote = await getClient({
      ...deps,
      timeoutMs: deps.timeoutMs || CARD_FETCH_TIMEOUT_MS,
    }).getCardDetails(id);
  } catch (err) {
    rethrowPago(err);
  }
  const fields = cardFieldsFromProvider(remote);
  if (!fields.pagoCardId) fields.pagoCardId = id;
  return savePagoCardLocally({
    userId,
    fields,
    cardEmail: deps.email || fields.email || user?.email || null,
    cardHolderName: deps.cardHolderName
      || fields.cardHolderName
      || user?.name
      || 'Card Holder',
  });
}

/**
 * Pull provider cards for the user's email across products and upsert locally.
 * Heals cases where Pago created a card but local insert failed.
 */
async function syncPagoCardsForUser(userId, { pagoCardId = null } = {}, deps = {}) {
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404, 'USER_NOT_FOUND');

  const explicitId = String(pagoCardId || '').trim();
  if (explicitId) {
    const row = await importPagoCardById(userId, explicitId, {
      ...deps,
      email: user.email,
      cardHolderName: user.name,
    });
    return { imported: 1, updated: 0, card: row, cards: [row] };
  }

  const email = String(user.email || '').trim();
  if (!email) {
    throw httpError('Add an email to your profile before syncing cards', 400, 'EMAIL_REQUIRED');
  }

  const deadline = Date.now() + Math.max(1000, Number(deps.syncBudgetMs) || CARD_SYNC_BUDGET_MS);
  let imported = 0;
  let updated = 0;
  let timedOut = false;
  const touched = [];

  const clientFor = () => {
    const left = deadline - Date.now();
    if (left < 1000) return null;
    if (deps.client) return deps.client;
    return getClient({
      timeoutMs: Math.min(CARD_FETCH_TIMEOUT_MS, left),
    });
  };

  for (const product of PAGO_PRODUCTS) {
    const client = clientFor();
    if (!client) {
      timedOut = true;
      break;
    }
    let summaries = [];
    try {
      if (typeof client.listCardsByEmail !== 'function') {
        throw httpError('Pago listCardsByEmail is unavailable', 503, 'PAGO_NOT_CONFIGURED');
      }
      summaries = await client.listCardsByEmail({
        email,
        product_code: product.code,
      });
    } catch (err) {
      if (isCardTimeoutError(err)) timedOut = true;
      console.warn('[pago] listCardsByEmail skipped:', product.code, err.message);
      if (timedOut) break;
      continue;
    }

    for (const summary of summaries || []) {
      const remoteId = String(summary.card_id || summary.cardid || '').trim();
      if (!remoteId) continue;

      const existing = await Card.findByPagoCardId(remoteId);
      if (existing && Number(existing.user_id) !== Number(userId)) {
        continue;
      }

      try {
        let remote;
        try {
          const detailClient = clientFor();
          if (!detailClient) {
            timedOut = true;
            break;
          }
          remote = await detailClient.getCardDetails(remoteId);
        } catch (err) {
          if (isCardTimeoutError(err)) timedOut = true;
          remote = {
            card_id: remoteId,
            product_code: summary.product_code || product.code,
            brand: summary.brand || null,
            status: 'active',
            name_on_card: user.name || null,
            email: summary.useremail || summary.email || email,
            last_four: summary.last_four || summary.lastfour || null,
            balance: null,
            card_number: null,
            cvv: null,
          };
        }
        const fields = cardFieldsFromProvider(remote);
        if (!fields.pagoCardId) fields.pagoCardId = remoteId;
        if (!fields.productCode) fields.productCode = product.code;
        if (!fields.lastFour && (summary.last_four || summary.lastfour)) {
          fields.lastFour = String(summary.last_four || summary.lastfour).replace(/\D/g, '').slice(-4);
        }

        if (existing) {
          const row = await Card.updateFromPago(existing.id, fields);
          updated += 1;
          touched.push(row);
        } else {
          const row = await savePagoCardLocally({
            userId,
            fields,
            cardEmail: email,
            cardHolderName: fields.cardHolderName || user.name || 'Card Holder',
          });
          imported += 1;
          touched.push(row);
        }
      } catch (err) {
        console.warn('[pago] sync card skipped:', remoteId, err.message);
      }
    }
    if (timedOut) break;
  }

  return { imported, updated, cards: touched, timed_out: timedOut };
}

async function refreshPagoCard(userId, localCardId, deps = {}) {
  const card = await Card.findById(localCardId);
  if (!card || Number(card.user_id) !== Number(userId)) {
    throw httpError('Card not found', 404, 'CARD_NOT_FOUND');
  }
  if (!card.pago_card_id) return card;

  let remote;
  try {
    remote = await getClient({
      ...deps,
      timeoutMs: deps.timeoutMs || CARD_FETCH_TIMEOUT_MS,
    }).getCardDetails(card.pago_card_id);
  } catch (err) {
    rethrowPago(err);
  }
  const fields = cardFieldsFromProvider(remote);
  return Card.updateFromPago(card.id, fields);
}

async function topUpPagoCard({ userId, localCardId, amountUsd }, deps = {}) {
  const card = await Card.findById(localCardId);
  if (!card || Number(card.user_id) !== Number(userId)) {
    throw httpError('Card not found', 404, 'CARD_NOT_FOUND');
  }
  if (!card.pago_card_id) {
    throw httpError('This card is not a Pago Card', 400, 'NOT_PAGO_CARD');
  }
  if (mapPagoStatus(card.pago_status || card.status) !== 'active' && String(card.status) !== 'active') {
    throw httpError('Only active cards can be topped up', 400, 'CARD_NOT_ACTIVE');
  }

  const settings = await getCardPricingSettings();
  const minTopUp = Math.max(MIN_TOP_UP, Number(settings.minimum_usdt_reload) || MIN_TOP_UP);
  let pricing;
  try {
    pricing = calculateCardReloadPricingUsdt(amountUsd, {
      ...settings,
      minimum_usdt_reload: minTopUp,
    });
  } catch (err) {
    throw httpError(err.message || 'Invalid top-up amount', 400, 'VALIDATION_ERROR');
  }
  const fundAmount = truncateUsd(pricing.net_usd_to_card);
  if (fundAmount < MIN_TOP_UP) {
    throw httpError(`Minimum top-up is $${MIN_TOP_UP.toFixed(2)}`, 400, 'VALIDATION_ERROR');
  }

  await debitUsdt(userId, pricing.deposit_usdt, {
    txType: 'balance_debit',
    description: `Pago Card top-up ${fundAmount.toFixed(2)} USD`,
    referenceType: 'cards_v2',
    referenceId: card.id,
    createdBy: 'user',
    metadata: {
      provider: 'pago',
      pago_card_id: card.pago_card_id,
      top_up_usd: fundAmount,
      reload_fee_usd: pricing.reload_fee_usd,
    },
  });

  let funded;
  try {
    funded = await getClient({
      ...deps,
      timeoutMs: deps.timeoutMs || CARD_CREATE_TIMEOUT_MS,
    }).topUpCard(
      card.pago_card_id,
      fundAmount,
      { idempotencyKey: `pago-fund-${userId}-${card.id}-${crypto.randomBytes(6).toString('hex')}` }
    );
  } catch (err) {
    await refundUsdt(userId, pricing.deposit_usdt, 'Refund Pago Card top-up');
    rethrowPago(err);
  }

  const display = funded?.display_amount != null ? Number(funded.display_amount) : null;
  const updated = await Card.updateFromPago(card.id, {
    status: 'active',
    pagoStatus: funded?.status || card.pago_status || 'active',
    balanceDisplayUsd: Number.isFinite(display)
      ? display
      : (Number(card.balance_display_usd || 0) + fundAmount),
    balanceCurrency: funded?.currency || card.balance_currency || 'USD',
  });

  await TransactionLog.create({
    userId,
    type: 'card_topup',
    description: `Pago Card top-up ${fundAmount.toFixed(2)} USD`,
    referenceType: 'cards_v2',
    referenceId: card.id,
    metadata: {
      provider: 'pago',
      pago_card_id: card.pago_card_id,
      pago_transaction_id: funded?.transaction_id || null,
      top_up_usd: fundAmount,
      reload_fee_usd: pricing.reload_fee_usd,
      debited_usdt: pricing.deposit_usdt,
    },
    createdBy: 'user',
  }).catch((err) => console.warn('[pago] top-up log skipped:', err.message));

  return {
    card: updated,
    debited_usdt: pricing.deposit_usdt,
    funded_usd: fundAmount,
    reload_fee_usd: pricing.reload_fee_usd,
    transaction_id: funded?.transaction_id || null,
    display_status: displayStatusLabel(updated?.status || 'active'),
  };
}

/**
 * Pago Card marketing/fees list Apple Pay & Google Pay as Supported, and the
 * ATM BIN notes contactless Google Pay. Public Business API docs expose create,
 * get, fund, freeze, PIN, and list — not push provisioning, OPC JWTs, or wallet
 * deep-link payloads. Wallet add is therefore a guided manual flow using the
 * revealed PAN/expiry/CVV until Pago enables issuer token provisioning.
 */
function getWalletProvisioningInfo(card = {}) {
  const product = String(card.product_code || card.productCode || '').trim().toLowerCase();
  const brand = String(card.brand || '').trim().toLowerCase();
  const isAtm = product === ATM_PRODUCT_CODE || product.includes('atm') || brand.includes('atm');
  const network = product.includes('master') || product.includes('536') || brand.includes('master')
    ? 'mastercard'
    : 'visa';

  return {
    provider: 'pago',
    product_code: product || null,
    network,
    mode: 'manual_add',
    push_provisioning_available: false,
    push_provisioning_reason:
      'Pago Card public API does not expose Apple Pay / Google Pay token provisioning or opaque payment credentials.',
    network_support: {
      apple_pay: true,
      google_pay: true,
    },
    contactless_google_pay: Boolean(isAtm),
    deep_links: {
      // Destination helpers only — not 1-click push provision payloads.
      google_wallet_web: 'https://pay.google.com/',
      google_wallet_play: 'https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel',
      apple_wallet_store: 'https://apps.apple.com/app/wallet/id1160481993',
    },
    apple_pay: {
      supported: true,
      mode: 'manual_add',
      button_label: 'Add to Apple Wallet',
    },
    google_pay: {
      supported: true,
      mode: 'manual_add',
      button_label: 'Add to Google Pay',
      contactless_hint: isAtm
        ? 'Visa ATM cards support contactless spend via Google Pay after you add the card.'
        : null,
    },
  };
}

function asTxnRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function pickTxnText(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null || typeof candidate === 'object') continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return null;
}

function parseTxnNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '');
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/** Prefer display dollars. Bare integers >= 10000 are Pagocards minor units (1 USD = 1_000_000). */
function dollarsFromTxnAmount(raw, { display = false } = {}) {
  const num = parseTxnNumber(raw);
  if (num == null) return null;
  if (display) return num;
  if (Number.isInteger(num) && Math.abs(num) >= 10000) return num / 1_000_000;
  return num;
}

function extractTransactionRows(payload) {
  if (Array.isArray(payload)) return payload;
  const root = asTxnRecord(payload);
  if (!root) return [];
  const keys = ['transactions', 'list', 'records', 'items', 'rows'];
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key];
  }
  if (Array.isArray(root.data)) return root.data;
  const nested = asTxnRecord(root.data) || asTxnRecord(root.result);
  if (!nested) return [];
  for (const key of keys) {
    if (Array.isArray(nested[key])) return nested[key];
  }
  return [];
}

function mapTxnStatus(rawStatus, rawType) {
  const status = String(rawStatus || '').toLowerCase().trim();
  const type = String(rawType || '').toLowerCase().trim();
  if (/refund|revers/.test(status) || /refund|revers/.test(type)) return 'refunded';
  if ([
    'success', 'successful', 'completed', 'complete', 'settled', 'posted',
    'approved', 'captured', 'cleared',
  ].includes(status)) return 'completed';
  if (['pending', 'processing', 'authorized', 'authorised', 'auth', 'hold'].includes(status)) {
    return 'pending';
  }
  if ([
    'failed', 'declined', 'rejected', 'void', 'voided', 'cancelled', 'canceled', 'error',
  ].includes(status)) return 'declined';
  if (/complet|settl|approv|captur|success|posted|clear/.test(status)) return 'completed';
  if (/pend|process|author/.test(status)) return 'pending';
  if (/fail|declin|reject|void|cancel/.test(status)) return 'declined';
  return 'unknown';
}

function normalizeTxnDate(value) {
  const text = pickTxnText(value);
  if (!text) return null;
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
  if (/^\d{13}$/.test(text)) return new Date(Number(text)).toISOString();
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return text;
}

/**
 * Turn a Pagocards transactions payload into rows the card detail UI can render.
 * OTP-only objects (no merchant and no amount) are skipped.
 */
function normalizePagoCardTransactions(payload) {
  const rows = extractTransactionRows(payload);
  const out = [];
  rows.forEach((row, index) => {
    const rec = asTxnRecord(row);
    if (!rec) return;
    const merchantObj = asTxnRecord(rec.merchant);
    const amountObj = asTxnRecord(rec.amount)
      || asTxnRecord(rec.transaction_amount)
      || asTxnRecord(rec.transactionAmount);
    const merchant = pickTxnText(
      rec.merchant_name,
      rec.merchantName,
      merchantObj && merchantObj.name,
      rec.description,
      rec.narrative,
      rec.merchant
    );
    const displayAmount = dollarsFromTxnAmount(
      rec.display_amount ?? rec.displayAmount ?? (amountObj && (amountObj.display_amount ?? amountObj.displayAmount)),
      { display: true }
    );
    const rawAmount = displayAmount != null
      ? displayAmount
      : dollarsFromTxnAmount(
        amountObj && amountObj.amount != null
          ? amountObj.amount
          : (typeof rec.amount === 'object' ? null : rec.amount)
            ?? rec.transaction_amount
            ?? rec.transactionAmount
            ?? rec.transCurrencyAmt
            ?? rec.billing_amount
      );
    if (!merchant && rawAmount == null) return;

    const status = mapTxnStatus(
      pickTxnText(rec.status, rec.transaction_status, rec.transactionStatus, rec.state, rec.auth_status),
      pickTxnText(rec.type, rec.transaction_type, rec.transactionType)
    );
    let amount = rawAmount == null ? null : Math.round(rawAmount * 100) / 100;
    if (amount != null && status === 'refunded' && amount > 0) amount = -amount;

    const currency = pickTxnText(
      rec.currency,
      rec.transaction_currency,
      rec.transactionCurrency,
      amountObj && amountObj.currency,
      rec.transCurrency
    ) || (amount != null ? 'USD' : null);

    const date = normalizeTxnDate(
      rec.created_at
      ?? rec.createdAt
      ?? rec.transaction_time
      ?? rec.transactionTime
      ?? rec.trans_time
      ?? rec.authorized_at
      ?? rec.posted_at
      ?? rec.date
      ?? rec.time
    );
    const id = pickTxnText(
      rec.id,
      rec.transaction_id,
      rec.transactionId,
      rec.reference,
      rec.authId,
      rec.auth_id
    ) || `tx-${index + 1}`;

    out.push({
      id,
      date,
      merchant: merchant || null,
      amount,
      currency,
      status,
    });
  });
  return out;
}

/**
 * Recent spend for one local card.
 * Docs: GET /api/v1/cards/{card_id}/transactions?pageNum=1
 */
async function listPagoCardTransactions({ userId, localCardId, page = 1 } = {}, deps = {}) {
  const card = await Card.findById(localCardId);
  if (!card || Number(card.user_id) !== Number(userId)) {
    throw httpError('Card not found', 404, 'CARD_NOT_FOUND');
  }
  const pageNum = Number.isFinite(Number(page)) && Number(page) > 0
    ? Math.min(20, Math.floor(Number(page)))
    : 1;
  if (!card.pago_card_id) {
    return {
      transactions: [],
      page: pageNum,
      card_id: card.id,
      pago_card_id: null,
    };
  }

  const client = getClient({
    ...deps,
    timeoutMs: deps.timeoutMs || CARD_FETCH_TIMEOUT_MS,
  });
  if (typeof client.listCardTransactions !== 'function') {
    throw httpError('Pago card transactions are unavailable', 503, 'PAGO_NOT_CONFIGURED');
  }

  let payload;
  try {
    payload = await withCardApiTimeout(
      client.listCardTransactions(card.pago_card_id, pageNum),
      (Number(deps.timeoutMs) || CARD_FETCH_TIMEOUT_MS) + 500,
      'Card transactions'
    );
  } catch (err) {
    rethrowPago(err);
  }

  return {
    transactions: normalizePagoCardTransactions(payload),
    page: pageNum,
    card_id: card.id,
    pago_card_id: card.pago_card_id,
  };
}

module.exports = {
  PAGO_PRODUCTS,
  DEFAULT_ISSUE_PRODUCT,
  CARD_CREATE_TIMEOUT_MS,
  CARD_CREATE_ROUTE_TIMEOUT_MS,
  CARD_FETCH_TIMEOUT_MS,
  CARD_SYNC_BUDGET_MS,
  withCardApiTimeout,
  isCardTimeoutError,
  issuePagoCardForUser,
  refreshPagoCard,
  topUpPagoCard,
  syncPagoCardsForUser,
  importPagoCardById,
  mapPagoStatus,
  getWalletProvisioningInfo,
  normalizePagoCardTransactions,
  listPagoCardTransactions,
};
