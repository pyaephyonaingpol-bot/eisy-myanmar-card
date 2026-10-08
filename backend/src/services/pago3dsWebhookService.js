/**
 * Pagocards webhook intake — 3DS OTP / verification events.
 *
 * Persist + dedupe by eventId, link to local cards_v2 via pago_card_id,
 * and expose rows for the dashboard Cards UI.
 *
 * Optional auth: PAGO_CARD_WEBHOOK_SECRET (header x-pago-webhook-secret).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Card = require('../models/Card');
const Pago3dsEvent = require('../models/Pago3dsEvent');

const OTP_TTL_MINUTES = 15;

let webhookLib = null;

function pagocardsWebhookLibCandidates() {
  return [
    path.join(__dirname, '../../../lib/pagocardsWebhook.cjs'),
    path.join(process.cwd(), 'lib/pagocardsWebhook.cjs'),
    path.join(__dirname, '../../../lib/pagocardsWebhook.js'),
    path.join(process.cwd(), 'lib/pagocardsWebhook.js'),
  ];
}

function resolvePagocardsWebhookLibPath() {
  return pagocardsWebhookLibCandidates().find((candidate) => fs.existsSync(candidate));
}

function unwrapWebhookModule(loaded) {
  if (loaded && typeof loaded.normalizePagocardsWebhook === 'function') return loaded;
  if (
    loaded
    && loaded.default
    && typeof loaded.default.normalizePagocardsWebhook === 'function'
  ) {
    return loaded.default;
  }
  return null;
}

function loadPagocardsWebhookLib() {
  if (webhookLib) return webhookLib;
  const file = resolvePagocardsWebhookLibPath();
  if (!file) {
    throw new Error('lib/pagocardsWebhook.cjs is not in the server bundle');
  }
  // Prefer .cjs — never eval the TS wrapper or ESM `export` on Vercel.
  // eslint-disable-next-line import/no-dynamic-require, global-require
  webhookLib = unwrapWebhookModule(require(file));
  if (!webhookLib || typeof webhookLib.normalizePagocardsWebhook !== 'function') {
    throw new Error('pagocardsWebhook lib missing normalizePagocardsWebhook');
  }
  return webhookLib;
}

/** Clear cached module so --watch / deploys pick up lib changes. */
function resetPagocardsWebhookLibCache() {
  webhookLib = null;
  for (const file of pagocardsWebhookLibCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const resolved = require.resolve(file);
      if (require.cache[resolved]) delete require.cache[resolved];
    } catch {
      /* ignore */
    }
  }
}

function getWebhookSecret() {
  return String(process.env.PAGO_CARD_WEBHOOK_SECRET || '').trim();
}

function assertWebhookSecret(req) {
  const expected = getWebhookSecret();
  if (!expected) return;
  const header =
    req.get?.('x-pago-webhook-secret')
    || req.get?.('x-pagocards-secret')
    || String(req.headers?.['x-pago-webhook-secret'] || '')
    || String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
    || '';
  if (header !== expected) {
    const err = new Error('Invalid Pagocards webhook secret');
    err.code = 'PAGO_WEBHOOK_UNAUTHORIZED';
    err.status = 401;
    throw err;
  }
}

/** SQLite-friendly UTC timestamp: YYYY-MM-DD HH:MM:SS */
function expiresAtSqlite(minutes = OTP_TTL_MINUTES) {
  const ms = Date.now() + Math.max(1, minutes) * 60 * 1000;
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function toPublicEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    event_type: row.event_type,
    auth_id: row.auth_id,
    otp: row.otp,
    pago_card_id: row.pago_card_id,
    local_card_id: row.local_card_id,
    merchant_name: row.merchant_name,
    transaction_amount: row.transaction_amount,
    transaction_currency: row.transaction_currency,
    verification_type: row.verification_type,
    received_at: row.received_at,
    seen_at: row.seen_at,
    expires_at: row.expires_at,
    is_3ds: String(row.event_type || '').toLowerCase().includes('3ds') || Boolean(row.otp),
  };
}

function payloadDebugKeys(body) {
  if (!body || typeof body !== 'object') return { type: typeof body };
  if (Array.isArray(body)) return { type: 'array', length: body.length };
  return { keys: Object.keys(body).slice(0, 40) };
}

/**
 * Handle an inbound Pagocards webhook body (Express or Next bridge).
 * @returns {{ saved: boolean, duplicate: boolean, ignored?: boolean, cardUpdated?: boolean, row: object|null, event: object|null }}
 */
async function handlePagocardsWebhook(body, req = null) {
  if (req) assertWebhookSecret(req);

  resetPagocardsWebhookLibCache();
  const { normalizePagocardsWebhook, summarizePagocardsEvent } = loadPagocardsWebhookLib();
  const event = normalizePagocardsWebhook(body);
  if (!event) {
    console.warn('[webhook/pagocards] unrecognized payload', payloadDebugKeys(body));
    return {
      saved: false,
      duplicate: false,
      ignored: true,
      cardUpdated: false,
      row: null,
      event: null,
    };
  }

  if (event.is3ds && !event.otp) {
    console.warn('[webhook/pagocards] 3DS event without otp field', {
      eventId: event.eventId,
      eventType: event.eventType,
      cardId: event.cardId,
      keys: event.raw ? Object.keys(event.raw).slice(0, 40) : [],
    });
  }

  console.log('[webhook/pagocards]', summarizePagocardsEvent(event), {
    eventId: event.eventId,
    authId: event.authId,
    is3ds: event.is3ds,
    hasOtp: Boolean(event.otp),
    localStatus: event.localStatus || null,
  });

  let localCard = null;
  if (event.cardId) {
    try {
      localCard = await Card.findByProviderCardId(event.cardId);
    } catch (err) {
      console.warn('[webhook/pagocards] card lookup failed:', err.message);
    }
  }

  if (!localCard && event.userBankcardId) {
    try {
      localCard = await Card.findByProviderCardId(event.userBankcardId);
    } catch (err) {
      console.warn('[webhook/pagocards] bankcard lookup failed:', err.message);
    }
  }

  if (!localCard && (event.cardId || event.userBankcardId)) {
    console.warn('[webhook/pagocards] no local card for pago_card_id',
      event.cardId || event.userBankcardId,
      '— storing orphan event (UI will match by pago_card_id once card is linked)');
  }

  const { row, duplicate } = await Pago3dsEvent.create({
    eventId: event.eventId,
    eventType: event.eventType,
    authId: event.authId,
    otp: event.otp,
    pagoCardId: event.cardId,
    localCardId: localCard?.id ?? null,
    userId: localCard?.user_id ?? null,
    merchantName: event.merchantName,
    transactionAmount: event.transactionAmount,
    transactionCurrency: event.transactionCurrency,
    verificationType: event.verificationType,
    userBankcardId: event.userBankcardId,
    rawPayload: event.raw,
    expiresAt: event.otp ? expiresAtSqlite(OTP_TTL_MINUTES) : expiresAtSqlite(60 * 24),
  });

  if (localCard?.id && event.cardId) {
    try {
      await Pago3dsEvent.linkOrphansByPagoCardId(event.cardId, {
        localCardId: localCard.id,
        userId: localCard.user_id,
      });
    } catch (err) {
      console.warn('[webhook/pagocards] orphan link skipped:', err.message);
    }
  }

  let cardUpdated = false;
  if (localCard && event.localStatus) {
    try {
      const updated = await Card.updateFromPago(localCard.id, {
        status: event.localStatus,
        pagoStatus: event.cardStatus || event.localStatus,
      });
      if (updated) {
        localCard = updated;
        cardUpdated = true;
      }
    } catch (err) {
      console.warn('[webhook/pagocards] card status update failed:', err.message);
    }
  }

  if (duplicate) {
    console.log('[webhook/pagocards] duplicate eventId', event.eventId);
  } else if (event.otp) {
    console.log('[webhook/pagocards] stored 3DS OTP for card', event.cardId || '(unknown)', {
      local_card_id: localCard?.id || null,
      user_id: localCard?.user_id || null,
      row_id: row?.id || null,
    });
  } else if (cardUpdated) {
    console.log('[webhook/pagocards] updated card status', {
      local_card_id: localCard?.id || null,
      status: event.localStatus,
      pago_status: event.cardStatus || event.localStatus,
    });
  }

  return {
    saved: !duplicate,
    duplicate,
    ignored: false,
    cardUpdated,
    row,
    event,
    public: toPublicEvent(row),
  };
}

function isPagoConfigError(err) {
  const code = String(err?.code || '');
  return code === 'PAGO_NOT_CONFIGURED' || code === 'PAGO_NO_FETCH';
}

/** Drop PAN / CVV if an OTP field sits on the same object as card secrets. */
function public3dsRaw(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const deny = /card_?number|pan|cvv|cvc|secret|pin|expiry|exp_month|exp_year/i;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (deny.test(key)) continue;
    if (value && typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Pull the latest 3DS OTP for one provider card.
 * Pagocards documents OTP delivery on the 3DS webhook only. The closest
 * documented reads are GET /api/v1/cards/{id} and
 * GET /api/v1/cards/{id}/transactions — scan those for otp fields.
 * Missing keys or upstream errors still leave stored webhook codes available.
 */
async function refreshCard3dsFromProvider({
  userId = null,
  localCardId = null,
  pagoCardId = null,
} = {}) {
  const summary = { provider_checked: false, imported: 0, error: null };
  const providerId = String(pagoCardId || '').trim();
  if (!providerId) return summary;

  let client;
  try {
    // Lazy require so webhook-only deploys still load this module.
    // eslint-disable-next-line global-require
    const { loadPagoCardClient } = require('./loadPagoCardClient');
    client = loadPagoCardClient().createPagoCardClient();
  } catch (err) {
    summary.error = err.code || err.message;
    console.warn('[pago3ds] client load skipped:', err.message);
    return summary;
  }

  const pulls = [
    ['transactions', () => client.listCardTransactions(providerId, 1)],
    ['details', () => client.getCardDetails(providerId)],
  ];
  const settled = await Promise.allSettled(pulls.map(([, fn]) => fn()));
  const payloads = [];
  settled.forEach((item, index) => {
    const label = pulls[index][0];
    if (item.status === 'fulfilled') {
      payloads.push(item.value);
      summary.provider_checked = true;
      return;
    }
    const err = item.reason || {};
    if (!isPagoConfigError(err)) {
      console.warn(`[pago3ds] ${label} refresh:`, err.code || err.message);
    }
    if (!summary.error) summary.error = err.code || err.message || 'PAGO_REFRESH_FAILED';
  });

  if (!payloads.length) return summary;

  let collect3dsOtps;
  try {
    ({ collect3dsOtps } = loadPagocardsWebhookLib());
  } catch (err) {
    summary.error = err.message;
    return summary;
  }
  if (typeof collect3dsOtps !== 'function') return summary;

  const expiresAt = expiresAtSqlite(OTP_TTL_MINUTES);
  for (const payload of payloads) {
    let events = [];
    try {
      events = collect3dsOtps(payload, providerId) || [];
    } catch (err) {
      console.warn('[pago3ds] otp scan skipped:', err.message);
      continue;
    }
    for (const event of events) {
      if (!event?.otp) continue;
      try {
        const saved = await Pago3dsEvent.create({
          eventId: event.eventId,
          eventType: event.eventType || '3ds',
          authId: event.authId,
          otp: event.otp,
          pagoCardId: event.cardId || providerId,
          localCardId: localCardId ?? null,
          userId: userId ?? null,
          merchantName: event.merchantName,
          transactionAmount: event.transactionAmount,
          transactionCurrency: event.transactionCurrency,
          verificationType: event.verificationType,
          userBankcardId: event.userBankcardId,
          rawPayload: public3dsRaw(event.raw),
          expiresAt,
          renewExpiry: true,
        });
        if (!saved.duplicate) summary.imported += 1;
      } catch (err) {
        console.warn('[pago3ds] store refreshed otp skipped:', err.message);
      }
    }
  }

  return summary;
}

async function listUser3dsEvents(userId, {
  localCardId = null,
  pagoCardId = null,
  limit = 20,
} = {}) {
  if (pagoCardId && localCardId != null) {
    try {
      await Pago3dsEvent.linkOrphansByPagoCardId(pagoCardId, {
        localCardId,
        userId,
      });
    } catch (err) {
      console.warn('[pago3ds] orphan claim skipped:', err.message);
    }
  }

  const rows = await Pago3dsEvent.listForUser(userId, {
    localCardId,
    pagoCardId,
    limit,
    includeExpired: false,
  });
  return rows.map(toPublicEvent);
}

async function markUser3dsSeen(userId, eventRowId) {
  const row = await Pago3dsEvent.markSeen(eventRowId, userId);
  return toPublicEvent(row);
}

module.exports = {
  handlePagocardsWebhook,
  refreshCard3dsFromProvider,
  listUser3dsEvents,
  markUser3dsSeen,
  toPublicEvent,
  loadPagocardsWebhookLib,
  resetPagocardsWebhookLibCache,
  OTP_TTL_MINUTES,
};
