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

function expiresAtIso(minutes = OTP_TTL_MINUTES) {
  const ms = Date.now() + Math.max(1, minutes) * 60 * 1000;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
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

/**
 * Handle an inbound Pagocards webhook body (Express or Next bridge).
 * @returns {{ saved: boolean, duplicate: boolean, ignored?: boolean, row: object|null, event: object|null }}
 */
async function handlePagocardsWebhook(body, req = null) {
  if (req) assertWebhookSecret(req);

  const { normalizePagocardsWebhook, summarizePagocardsEvent } = loadPagocardsWebhookLib();
  const event = normalizePagocardsWebhook(body);
  if (!event) {
    console.warn('[webhook/pagocards] unrecognized payload');
    return { saved: false, duplicate: false, ignored: true, row: null, event: null };
  }

  console.log('[webhook/pagocards]', summarizePagocardsEvent(event), {
    eventId: event.eventId,
    authId: event.authId,
    is3ds: event.is3ds,
  });

  let localCard = null;
  if (event.cardId) {
    try {
      localCard = await Card.findByProviderCardId(event.cardId);
    } catch (err) {
      console.warn('[webhook/pagocards] card lookup failed:', err.message);
    }
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
    expiresAt: event.otp ? expiresAtIso(OTP_TTL_MINUTES) : expiresAtIso(60 * 24),
  });

  if (duplicate) {
    console.log('[webhook/pagocards] duplicate eventId', event.eventId);
  } else if (event.otp) {
    console.log('[webhook/pagocards] stored 3DS OTP for card', event.cardId || '(unknown)', {
      local_card_id: localCard?.id || null,
      user_id: localCard?.user_id || null,
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

async function listUser3dsEvents(userId, { localCardId = null, limit = 20 } = {}) {
  const rows = await Pago3dsEvent.listForUser(userId, { localCardId, limit, includeExpired: false });
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
  OTP_TTL_MINUTES,
};
