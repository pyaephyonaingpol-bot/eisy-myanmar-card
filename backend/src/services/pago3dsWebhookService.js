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
const Module = require('module');
const Card = require('../models/Card');
const Pago3dsEvent = require('../models/Pago3dsEvent');

const OTP_TTL_MINUTES = 15;

function stripTypes(source) {
  if (typeof Module.stripTypeScriptTypes !== 'function') {
    throw new Error('Node stripTypeScriptTypes unavailable — cannot load lib/pagocardsWebhook.ts');
  }
  const emitWarning = process.emitWarning;
  process.emitWarning = function hideStripWarning(warning, type, code, ...rest) {
    const message = typeof warning === 'string' ? warning : warning && warning.message;
    const name = type || (warning && warning.name) || code;
    if (name === 'ExperimentalWarning' && /stripTypeScriptTypes/.test(String(message || ''))) {
      return undefined;
    }
    return emitWarning.call(process, warning, type, code, ...rest);
  };
  try {
    return Module.stripTypeScriptTypes(source);
  } finally {
    process.emitWarning = emitWarning;
  }
}

let webhookLib = null;

function loadPagocardsWebhookLib() {
  if (webhookLib) return webhookLib;
  const candidates = [
    path.join(__dirname, '../../../lib/pagocardsWebhook.ts'),
    path.join(process.cwd(), 'lib/pagocardsWebhook.ts'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new Error('lib/pagocardsWebhook.ts is not in the server bundle');
  }
  const source = stripTypes(fs.readFileSync(file, 'utf8'));
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source, file);
  webhookLib = loaded.exports;
  return webhookLib;
}

/** Clear cached TS module so --watch / deploys pick up lib changes. */
function resetPagocardsWebhookLibCache() {
  webhookLib = null;
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
 * @returns {{ saved: boolean, duplicate: boolean, ignored?: boolean, row: object|null, event: object|null }}
 */
async function handlePagocardsWebhook(body, req = null) {
  if (req) assertWebhookSecret(req);

  // Always reload normalizer in case lib/pagocardsWebhook.ts changed under watch.
  resetPagocardsWebhookLibCache();
  const { normalizePagocardsWebhook, summarizePagocardsEvent } = loadPagocardsWebhookLib();
  const event = normalizePagocardsWebhook(body);
  if (!event) {
    console.warn('[webhook/pagocards] unrecognized payload', payloadDebugKeys(body));
    return { saved: false, duplicate: false, ignored: true, row: null, event: null };
  }

  if (!event.otp) {
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
  });

  let localCard = null;
  if (event.cardId) {
    try {
      localCard = await Card.findByProviderCardId(event.cardId);
    } catch (err) {
      console.warn('[webhook/pagocards] card lookup failed:', err.message);
    }
  }

  if (!localCard && event.cardId) {
    console.warn('[webhook/pagocards] no local card for pago_card_id', event.cardId,
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

  if (duplicate) {
    console.log('[webhook/pagocards] duplicate eventId', event.eventId);
  } else if (event.otp) {
    console.log('[webhook/pagocards] stored 3DS OTP for card', event.cardId || '(unknown)', {
      local_card_id: localCard?.id || null,
      user_id: localCard?.user_id || null,
      row_id: row?.id || null,
    });
  }

  return {
    saved: !duplicate,
    duplicate,
    ignored: false,
    row,
    event,
    public: toPublicEvent(row),
  };
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
  listUser3dsEvents,
  markUser3dsSeen,
  toPublicEvent,
  loadPagocardsWebhookLib,
  resetPagocardsWebhookLibCache,
  OTP_TTL_MINUTES,
};
