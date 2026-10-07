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

const PAGO_PRODUCTS = [
  { code: 'us_493_visa_bin_v2', label: 'Visa (493)', allows_initial_load: true },
  { code: 'us_404_visa_bin', label: 'Visa (404)', allows_initial_load: true },
  { code: 'us_493_visa_atm', label: 'Visa ATM', allows_initial_load: false },
  { code: '536_master', label: 'Mastercard', allows_initial_load: true },
];

const PRODUCT_CODES = new Set(PAGO_PRODUCTS.map((item) => item.code));
const ATM_PRODUCT_CODE = 'us_493_visa_atm';
const MIN_INITIAL_LOAD = 10;
const MAX_INITIAL_LOAD = 2500;
const MIN_TOP_UP = 5;

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
  if (['active', 'activated', 'enabled', 'open'].includes(status)) return 'active';
  if (['pending', 'processing', 'creating', 'issued'].includes(status)) return 'pending';
  if (['frozen', 'freeze', 'blocked', 'inactive', 'suspended'].includes(status)) return 'frozen';
  if (['terminated', 'cancelled', 'canceled', 'closed', 'expired'].includes(status)) return 'terminated';
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

function cardFieldsFromProvider(card) {
  const balance = readBalance(card);
  const number = card.card_number || card.cardnumber || null;
  const digits = String(number || '').replace(/\D/g, '');
  const lastFour = String(card.last_four || digits.slice(-4) || '').slice(-4);
  const expiryMonth = card.expiry_month || null;
  const expiryYear = card.expiry_year || null;
  const expDate = card.expiredate
    || [expiryMonth, expiryYear].filter(Boolean).join('/')
    || null;
  return {
    pagoCardId: String(card.card_id || '').trim(),
    productCode: card.product_code || null,
    brand: card.brand || null,
    status: mapPagoStatus(card.status),
    pagoStatus: card.status || null,
    cardNumber: number,
    expDate,
    cvv: card.cvv || null,
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

function getClient(deps) {
  if (deps.client) return deps.client;
  return loadPagoCardClient().createPagoCardClient();
}

function rethrowPago(err) {
  const code = err?.code || 'PAGO_ERROR';
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

  let debited = 0;
  if (load != null) {
    await debitUsdt(userId, load, {
      txType: 'balance_debit',
      description: `Pago Card starting balance ${load.toFixed(2)} USD`,
      referenceType: 'cards_v2',
      createdBy: 'user',
      metadata: { provider: 'pago', product_code: product, initial_load: load },
    });
    debited = load;
  }

  let created;
  try {
    created = await getClient(deps).createVirtualCard({
      product_code: product,
      first_name: names.first_name,
      last_name: names.last_name,
      email: cardEmail,
      initial_load: load == null ? undefined : load,
      idempotencyKey: `pago-issue-${userId}-${crypto.randomBytes(8).toString('hex')}`,
    });
  } catch (err) {
    if (debited > 0) {
      await refundUsdt(userId, debited, 'Refund Pago Card starting balance');
    }
    rethrowPago(err);
  }

  const fields = cardFieldsFromProvider(created);
  if (!fields.pagoCardId) {
    throw httpError('Pago Card did not return a card id', 502, 'PAGO_BAD_RESPONSE');
  }

  let row;
  try {
    row = await Card.createFromPago({
      userId,
      ...fields,
      cardHolderName: fields.cardHolderName || `${names.first_name} ${names.last_name}`,
      email: cardEmail,
    });
  } catch (err) {
    const wrapped = httpError(
      'The card was created at Pago Card but could not be saved locally',
      500,
      'PAGO_CARD_SAVE_FAILED'
    );
    wrapped.pago_card_id = fields.pagoCardId;
    throw wrapped;
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

  return { card: row, debited_usdt: debited };
}

async function refreshPagoCard(userId, localCardId, deps = {}) {
  const card = await Card.findById(localCardId);
  if (!card || Number(card.user_id) !== Number(userId)) {
    throw httpError('Card not found', 404, 'CARD_NOT_FOUND');
  }
  if (!card.pago_card_id) return card;

  let remote;
  try {
    remote = await getClient(deps).getCardDetails(card.pago_card_id);
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
    funded = await getClient(deps).topUpCard(
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

module.exports = {
  PAGO_PRODUCTS,
  issuePagoCardForUser,
  refreshPagoCard,
  topUpPagoCard,
  mapPagoStatus,
};
