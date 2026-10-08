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

  // Create often returns card_number/cvv null; Get Card fills PAN/CVV/expiry.
  created = await enrichCreatedCard(created, deps);

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

  return { card: row, debited_usdt: debited };
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
      const remote = await getClient(deps).getCardDetails(id);
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
    remote = await getClient(deps).getCardDetails(id);
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

  const client = getClient(deps);
  let imported = 0;
  let updated = 0;
  const touched = [];

  for (const product of PAGO_PRODUCTS) {
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
      console.warn('[pago] listCardsByEmail skipped:', product.code, err.message);
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
          remote = await client.getCardDetails(remoteId);
        } catch (_) {
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
  }

  return { imported, updated, cards: touched };
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

module.exports = {
  PAGO_PRODUCTS,
  issuePagoCardForUser,
  refreshPagoCard,
  topUpPagoCard,
  syncPagoCardsForUser,
  importPagoCardById,
  mapPagoStatus,
  getWalletProvisioningInfo,
};
