/**
 * Bitnob virtual-card webhook intake + provider sync (polling safety net).
 *
 * Webhooks are async for create/fund. Verify HMAC-SHA512 of the raw body with
 * BITNOB_WEBHOOK_SECRET against x-bitnob-signature, then update local cards_v2.
 *
 * Docs:
 *   https://bitnob.dev/docs/card-issuing/webhook-security-delivery
 *   https://bitnob.dev/api-reference/virtual-cards/webhooks
 */

'use strict';

const crypto = require('crypto');
const Card = require('../models/Card');
const TransactionLog = require('../models/TransactionLog');
const {
  getCardDetails,
  microunitsToUsd,
  normalizeBitnobCard,
} = require('./bitnobService');

const HANDLED_EVENTS = new Set([
  'virtualcard.created.completed',
  'virtualcard.created.failed',
  'virtualcard.topup.completed',
  'virtualcard.topup.failed',
]);

/** In-memory idempotency for recent eventIds (retries reuse the same id). */
const recentEventIds = new Map();
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_MAX = 2000;

function getWebhookSecret() {
  return String(
    process.env.BITNOB_WEBHOOK_SECRET
    || process.env.BITNOB_CLIENT_SECRET
    || process.env.BITNOB_SECRET_KEY
    || ''
  ).trim();
}

function isBitnobWebhookConfigured() {
  return Boolean(getWebhookSecret());
}

function rememberEventId(eventId) {
  const id = String(eventId || '').trim();
  if (!id) return false;
  const now = Date.now();
  if (recentEventIds.has(id)) return true;
  recentEventIds.set(id, now);
  if (recentEventIds.size > EVENT_MAX) {
    for (const [key, ts] of recentEventIds) {
      if (now - ts > EVENT_TTL_MS || recentEventIds.size > EVENT_MAX) {
        recentEventIds.delete(key);
      } else {
        break;
      }
    }
  }
  return false;
}

function resetBitnobWebhookDedupeForTests() {
  recentEventIds.clear();
}

/**
 * Verify x-bitnob-signature = HMAC-SHA512(rawBody, webhookSecret) hex.
 * Must use the exact raw body bytes (req.rawBody / rawBodyBuffer).
 */
function verifyBitnobWebhookSignature(req) {
  const secret = getWebhookSecret();
  if (!secret) {
    const err = new Error(
      'Bitnob webhook secret missing. Set BITNOB_WEBHOOK_SECRET (or BITNOB_CLIENT_SECRET).'
    );
    err.code = 'BITNOB_WEBHOOK_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const signature = String(
    req.headers?.['x-bitnob-signature']
    || req.headers?.['X-Bitnob-Signature']
    || ''
  ).trim().toLowerCase();

  if (!signature) {
    const err = new Error('Missing x-bitnob-signature header');
    err.code = 'BITNOB_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  const raw = req.rawBodyBuffer || req.rawBody;
  if (raw == null || raw === '') {
    const err = new Error('Missing raw request body required for Bitnob signature verification');
    err.code = 'BITNOB_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  const bodyBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  const expected = crypto.createHmac('sha512', secret).update(bodyBuf).digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    const err = new Error('Bitnob webhook signature verification failed');
    err.code = 'BITNOB_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  return true;
}

function pickEventName(payload) {
  return String(
    payload?.event
    || payload?.eventName
    || payload?.type
    || payload?.data?.event
    || ''
  ).trim();
}

function pickEventId(payload) {
  return String(
    payload?.eventId
    || payload?.event_id
    || payload?.id
    || payload?.data?.eventId
    || ''
  ).trim() || null;
}

function unwrapCardPayload(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const card = data?.card && typeof data.card === 'object' ? data.card : data;
  return { data, card };
}

function extractProviderCardId(payload) {
  const { data, card } = unwrapCardPayload(payload);
  return String(
    card?.id
    || card?.card_id
    || card?.cardId
    || data?.cardId
    || data?.card_id
    || payload?.cardId
    || payload?.card_id
    || ''
  ).trim() || null;
}

function extractBalanceUsd(payload) {
  const { data, card } = unwrapCardPayload(payload);
  const display = card?.display_amount ?? data?.display_amount ?? data?.displayAmount;
  if (display != null && Number.isFinite(Number(display))) return Number(display);

  const micro = card?.balance_amount
    ?? data?.balance_amount
    ?? data?.balanceAmount
    ?? data?.amount
    ?? payload?.amount;
  const usd = microunitsToUsd(micro);
  return usd != null ? usd : null;
}

function extractReference(payload) {
  const { data, card } = unwrapCardPayload(payload);
  return String(
    data?.reference
    || card?.reference
    || payload?.reference
    || data?.transaction?.reference
    || ''
  ).trim() || null;
}

function extractFailureReason(payload) {
  const { data } = unwrapCardPayload(payload);
  return String(
    data?.reason
    || data?.message
    || payload?.reason
    || payload?.message
    || 'Bitnob reported failure'
  ).trim();
}

async function applyCreatedCompleted(localCard, payload) {
  const providerCardId = extractProviderCardId(payload);
  let remote = null;
  if (providerCardId) {
    try {
      const details = await getCardDetails(providerCardId);
      remote = details.card;
    } catch (err) {
      console.warn('[bitnob-webhook] getCardDetails after create failed:', err.message);
    }
  }

  const { card: eventCard } = unwrapCardPayload(payload);
  const masked = remote?.masked_pan
    || eventCard?.masked_pan
    || eventCard?.maskedPan
    || null;
  const balanceUsd = remote?.balance_usd ?? extractBalanceUsd(payload);
  const bitnobStatus = remote?.status || eventCard?.status || 'active';

  const patch = {
    provider: 'bitnob',
    provider_card_id: providerCardId || undefined,
    bitnob_card_id: providerCardId || undefined,
    created_status: 'completed',
    bitnob_status: bitnobStatus,
    request_status: 'provider_ready',
    masked_pan: masked,
    last_webhook_event: 'virtualcard.created.completed',
    last_webhook_at: new Date().toISOString(),
  };
  if (balanceUsd != null) patch.balance_usd = balanceUsd;

  // Promote pending local rows once the provider finished provisioning.
  const isPending = String(localCard.status || '').toLowerCase() === 'pending'
    || String(localCard.card_number || '').startsWith('PENDING-');

  if (isPending && masked) {
    await Card.updateCardDetails(localCard.id, {
      cardNumber: masked,
      cardHolderName: remote?.name || eventCard?.name || undefined,
      status: (bitnobStatus === 'active' || bitnobStatus === 'pending') ? 'active' : localCard.status,
      balanceUsd: balanceUsd ?? undefined,
      adminNotes: 'Activated from Bitnob virtualcard.created.completed webhook',
    });
    return Card.mergeMetadata(localCard.id, {
      ...patch,
      request_status: 'approved',
      activated_via: 'bitnob_webhook',
    });
  }

  return Card.mergeMetadata(localCard.id, patch, {
    status: isPending && bitnobStatus === 'active' ? 'active' : undefined,
  });
}

async function applyCreatedFailed(localCard, payload) {
  const reason = extractFailureReason(payload);
  return Card.mergeMetadata(localCard.id, {
    provider: 'bitnob',
    created_status: 'failed',
    bitnob_status: 'failed',
    request_status: 'provider_failed',
    provider_failure_reason: reason,
    last_webhook_event: 'virtualcard.created.failed',
    last_webhook_at: new Date().toISOString(),
  });
}

async function applyTopupResult(localCard, payload, { ok }) {
  const balanceUsd = extractBalanceUsd(payload);
  const reference = extractReference(payload);
  const patch = {
    provider: 'bitnob',
    last_fund_reference: reference,
    last_fund_status: ok ? 'completed' : 'failed',
    last_webhook_event: ok ? 'virtualcard.topup.completed' : 'virtualcard.topup.failed',
    last_webhook_at: new Date().toISOString(),
  };
  if (ok && balanceUsd != null) patch.balance_usd = balanceUsd;
  if (!ok) patch.last_fund_failure_reason = extractFailureReason(payload);

  // Prefer live balance when available.
  const providerCardId = extractProviderCardId(payload)
    || (() => {
      try {
        const m = localCard.metadata ? JSON.parse(localCard.metadata) : {};
        return m.provider_card_id || null;
      } catch (_) {
        return null;
      }
    })();

  if (ok && providerCardId) {
    try {
      const details = await getCardDetails(providerCardId);
      if (details.card?.balance_usd != null) patch.balance_usd = details.card.balance_usd;
      if (details.card?.status) patch.bitnob_status = details.card.status;
    } catch (err) {
      console.warn('[bitnob-webhook] getCardDetails after topup failed:', err.message);
    }
  }

  return Card.mergeMetadata(localCard.id, patch);
}

/**
 * Process a verified Bitnob webhook payload.
 */
async function processBitnobCardWebhook(payload) {
  const event = pickEventName(payload);
  const eventId = pickEventId(payload);

  if (!event) {
    return { handled: false, ignored: true, reason: 'missing_event' };
  }

  if (!HANDLED_EVENTS.has(event)) {
    return { handled: false, ignored: true, reason: 'unhandled_event', event, eventId };
  }

  if (eventId && rememberEventId(eventId)) {
    return { handled: true, duplicate: true, event, eventId };
  }

  const providerCardId = extractProviderCardId(payload);
  if (!providerCardId) {
    return { handled: false, ignored: true, reason: 'missing_card_id', event, eventId };
  }

  const localCard = await Card.findByProviderCardId(providerCardId);
  if (!localCard) {
    // ACK unknown cards so Bitnob stops retrying; ops can reconcile via sync.
    console.warn('[bitnob-webhook] no local card for provider id', providerCardId, event);
    return {
      handled: true,
      unmatched: true,
      event,
      eventId,
      provider_card_id: providerCardId,
    };
  }

  let updated = null;
  if (event === 'virtualcard.created.completed') {
    updated = await applyCreatedCompleted(localCard, payload);
  } else if (event === 'virtualcard.created.failed') {
    updated = await applyCreatedFailed(localCard, payload);
  } else if (event === 'virtualcard.topup.completed') {
    updated = await applyTopupResult(localCard, payload, { ok: true });
  } else if (event === 'virtualcard.topup.failed') {
    updated = await applyTopupResult(localCard, payload, { ok: false });
  }

  try {
    await TransactionLog.create({
      userId: localCard.user_id,
      type: 'card_updated',
      direction: 'neutral',
      amountUsd: extractBalanceUsd(payload),
      referenceType: 'cards_v2',
      referenceId: localCard.id,
      description: `Bitnob webhook ${event}`,
      createdBy: 'system',
      metadata: {
        provider: 'bitnob',
        event,
        event_id: eventId,
        provider_card_id: providerCardId,
        reference: extractReference(payload),
      },
    });
  } catch (logErr) {
    console.warn('[bitnob-webhook] transaction log skipped:', logErr.message);
  }

  return {
    handled: true,
    event,
    eventId,
    provider_card_id: providerCardId,
    card_id: localCard.id,
    status: updated?.status || localCard.status,
  };
}

/**
 * Express entry: verify signature → process event.
 */
async function handleBitnobCardWebhook(req) {
  verifyBitnobWebhookSignature(req);

  let payload = req.body;
  if ((!payload || typeof payload !== 'object') && req.rawBody) {
    try {
      payload = JSON.parse(req.rawBody);
    } catch (_) {
      const err = new Error('Invalid JSON webhook body');
      err.code = 'BITNOB_WEBHOOK_BAD_BODY';
      err.status = 400;
      throw err;
    }
  }

  return processBitnobCardWebhook(payload || {});
}

/**
 * Poll Bitnob for the latest card state and merge into local cards_v2.
 * Used as a safety net when webhooks are delayed or missed.
 */
async function syncBitnobCardFromProvider(localCardId, { userId = null } = {}) {
  const card = await Card.findById(localCardId);
  if (!card) {
    const err = new Error('Card not found');
    err.code = 'CARD_NOT_FOUND';
    throw err;
  }
  if (userId != null && Number(card.user_id) !== Number(userId)) {
    const err = new Error('Card not found');
    err.code = 'CARD_NOT_FOUND';
    throw err;
  }

  let metadata = {};
  try {
    metadata = card.metadata ? JSON.parse(card.metadata) : {};
  } catch (_) {
    metadata = {};
  }

  if (metadata.provider && metadata.provider !== 'bitnob') {
    const err = new Error('Card is not a Bitnob virtual card');
    err.code = 'NOT_BITNOB_CARD';
    throw err;
  }

  const providerCardId = String(metadata.provider_card_id || metadata.bitnob_card_id || '').trim();
  if (!providerCardId) {
    const err = new Error('Card has no Bitnob provider_card_id to sync');
    err.code = 'BITNOB_CARD_ID_REQUIRED';
    throw err;
  }

  const { card: remote, raw } = await getCardDetails(providerCardId);
  const normalized = normalizeBitnobCard(remote) || remote;

  const patch = {
    provider: 'bitnob',
    provider_card_id: providerCardId,
    bitnob_card_id: providerCardId,
    bitnob_status: normalized.status || null,
    created_status: normalized.created_status || null,
    masked_pan: normalized.masked_pan || metadata.masked_pan || null,
    balance_usd: normalized.balance_usd != null ? normalized.balance_usd : metadata.balance_usd,
    last_synced_at: new Date().toISOString(),
    last_sync_source: 'poll',
  };

  if (normalized.created_status === 'completed' || normalized.status === 'active') {
    patch.request_status = metadata.request_status === 'approved'
      ? 'approved'
      : 'provider_ready';
  }

  const isPending = String(card.status || '').toLowerCase() === 'pending'
    || String(card.card_number || '').startsWith('PENDING-');

  if (isPending && patch.masked_pan && (normalized.status === 'active' || normalized.created_status === 'completed')) {
    await Card.updateCardDetails(card.id, {
      cardNumber: patch.masked_pan,
      cardHolderName: normalized.name || undefined,
      status: 'active',
      balanceUsd: patch.balance_usd,
      adminNotes: 'Synced from Bitnob getCardDetails poll',
    });
    patch.request_status = 'approved';
    patch.activated_via = 'bitnob_poll';
  }

  const updated = await Card.mergeMetadata(card.id, patch);
  return {
    card: updated,
    provider_card: normalized,
    raw,
  };
}

module.exports = {
  HANDLED_EVENTS,
  getWebhookSecret,
  isBitnobWebhookConfigured,
  verifyBitnobWebhookSignature,
  processBitnobCardWebhook,
  handleBitnobCardWebhook,
  syncBitnobCardFromProvider,
  resetBitnobWebhookDedupeForTests,
  // test helpers
  pickEventName,
  pickEventId,
  extractProviderCardId,
  extractBalanceUsd,
};
