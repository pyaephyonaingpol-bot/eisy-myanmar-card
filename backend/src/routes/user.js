const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const DepositRequest = require('../models/DepositRequest');
const { enrichDeposit } = require('../services/depositEnrichment');
const {
  getUsdtDepositSettings,
  parseRecordMetadata,
} = require('../services/settingsService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { walletPayload, formatUsdt, migrateLegacyUsdToMmk } = require('../services/walletService');
const { overlayWalletPayloadFromSupabase } = require('../services/supabaseWalletReadService');
const { ensureSupabaseUserWalletInBackground } = require('../services/supabaseSyncService');
const { mapPublicUser, updateUserProfile } = require('../services/profileService');
const {
  isPendingCardRecord,
  normalizeCardStatus,
  displayStatusLabel,
  isCardReloadAllowed,
  isCardVisibleInUserList,
} = require('../constants/cardStatuses');
const router = express.Router();

function resolveClientCardStatus(c) {
  if (isPendingCardRecord(c)) return 'pending';
  return normalizeCardStatus(c?.status);
}

function mapCardForClient(c) {
  let metadata = {};
  try { metadata = c.metadata ? JSON.parse(c.metadata) : {}; } catch (_) {}

  const pending = isPendingCardRecord(c);
  const status = resolveClientCardStatus(c);
  const digits = pending ? '' : String(c.card_number || '').replace(/\s/g, '');
  const storedLast4 = String(c.last_four || '').replace(/\D/g, '').slice(-4);
  const last4 = storedLast4 || (digits.length >= 4 ? digits.slice(-4) : '????');

  return {
    id: c.id,
    card_number: pending ? null : c.card_number,
    exp_date: pending ? null : c.exp_date,
    cvv: pending ? null : c.cvv,
    card_holder_name: c.card_holder_name,
    status,
    display_status: displayStatusLabel(status),
    status_reason: c.status_reason || null,
    request_status: metadata.request_status || (pending ? 'pending_approval' : 'approved'),
    is_primary: Boolean(c.is_primary),
    balance_usd: c.balance_display_usd ?? metadata.balance_usd ?? null,
    balance_display_usd: c.balance_display_usd ?? metadata.balance_usd ?? null,
    expiry_month: pending ? null : (c.expiry_month || null),
    expiry_year: pending ? null : (c.expiry_year || null),
    pago_card_id: c.pago_card_id || metadata.pago_card_id || null,
    product_code: c.product_code || metadata.product_code || null,
    brand: c.brand || metadata.brand || null,
    pago_status: c.pago_status || metadata.pago_status || null,
    currency: c.balance_currency || c.currency || 'USD',
    provider: (() => {
      if (c.pago_card_id || metadata.pago_card_id || c.provider === 'pago' || metadata.provider === 'pago') {
        return 'pago';
      }
      const p = String(metadata.provider || c.provider || '').toLowerCase();
      if (!p || p === 'bitnob' || p === 'bitnod' || p === 'standard') return null;
      return 'legacy';
    })(),
    card_flow: metadata.card_flow || null,
    funding_wallet: metadata.wallet_type || metadata.payment_method || null,
    created_at: c.created_at,
    activated_at: metadata.activated_at || c.activated_at || null,
    label: pending ? 'Pending request' : `Card •••• ${last4}${c.is_primary ? ' (Primary)' : ''}`,
    last4,
  };
}

async function getUserCardsPayload(userId) {
  const db = getDb();
  const allV2 = await Card.findByUserId(userId);
  let cards = allV2.filter(isCardVisibleInUserList);

  // Legacy `cards` table is only for users who never received a cards_v2 row.
  // Do not resurrect a legacy card when cards_v2 rows exist but are hidden/terminated.
  if (!cards.length) {
    const countRow = await db.get(
      'SELECT COUNT(*) AS c FROM cards_v2 WHERE user_id = ?',
      userId
    );
    const hasV2Rows = Number(countRow?.c || 0) > 0;
    if (!hasV2Rows) {
      const legacy = await db.get('SELECT * FROM cards WHERE user_id = ?', userId);
      if (legacy) {
        const legacyCard = {
          ...legacy,
          status: 'active',
          is_primary: 1,
          metadata: null,
        };
        if (isCardVisibleInUserList(legacyCard)) {
          cards = [legacyCard];
        }
      }
    }
  }

  const mapped = cards.map(mapCardForClient);
  const primaryIdx = mapped.findIndex((c) => c.is_primary);
  const activeIdx = primaryIdx >= 0 ? primaryIdx : 0;

  return { cards: mapped, active_index: activeIdx };
}

function setCardsNoStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

router.get('/cards', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const user = await User.findById(req.user.id);
    const wantSync = String(req.query?.sync || req.query?.reconcile || '').trim() === '1'
      || String(req.query?.sync || '').toLowerCase() === 'true';

    let payload = await getUserCardsPayload(req.user.id);
    // Empty local list (or explicit ?sync=1): import orphaned provider cards.
    if (wantSync || payload.cards.length === 0) {
      try {
        const { syncPagoCardsForUser } = require('../services/pagoCardService');
        await syncPagoCardsForUser(req.user.id, {});
        payload = await getUserCardsPayload(req.user.id);
      } catch (err) {
        console.warn('[user/cards] pago sync skipped:', err.message);
      }
    }

    // Always 200 — empty list is a valid state (new users / post-request).
    // Returning 404 here made the dashboard wipe cards and look "broken".
    res.json({
      user: { id: user.id, name: user.name },
      ...payload,
      card: payload.cards.length ? payload.cards[payload.active_index] : null,
    });
  } catch (err) {
    console.error('[user/cards]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Soft-remove a card from My Cards (hide from list / cancel pending request).
 * Does not hard-delete ledger or reload history.
 */
router.post('/cards/:id/remove', requireAuth, requireSensitive, async (req, res) => {
  try {
    const cardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'Invalid card id', code: 'INVALID_CARD_ID' });
    }

    const existing = await Card.findById(cardId);
    if (!existing || Number(existing.user_id) !== Number(req.user.id)) {
      return res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
    }

    const removed = await Card.removeFromUserList(cardId, req.user.id, {
      reason: req.body?.reason || 'Removed by user',
    });
    if (!removed) {
      return res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
    }

    await TransactionLog.create({
      userId: req.user.id,
      type: 'card_cancelled',
      description: `Card removed from My Cards (id ${cardId})`,
      referenceType: 'card',
      referenceId: cardId,
      metadata: { card_id: cardId, soft_remove: true },
      createdBy: 'user',
    }).catch((err) => console.warn('[user/cards/remove] log skipped:', err.message));

    const payload = await getUserCardsPayload(req.user.id);
    res.json({
      success: true,
      message: 'Card removed from My Cards',
      removed_card_id: cardId,
      ...payload,
    });
  } catch (err) {
    console.error('[user/cards/remove]', err);
    res.status(500).json({ error: err.message || 'Failed to remove card' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      user: {
        ...mapPublicUser(user),
        has_pin: Boolean(user.pin_hash),
        has_password: Boolean(user.password_hash),
        biometrics_enabled: Boolean(user.biometrics_enabled),
        kyc_status: (user.kyc_status || 'UNVERIFIED').toUpperCase(),
        is_kyc_verified: (user.kyc_status || '').toUpperCase() === 'VERIFIED',
      },
    });
  } catch (err) {
    console.error('[user/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { name, phone } = req.body || {};
    if (name == null && phone === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Provide name and/or phone to update',
        code: 'PROFILE_NOTHING_TO_UPDATE',
      });
    }

    const user = await updateUserProfile(req.user.id, { name, phone });
    res.json({
      success: true,
      message: 'Profile updated',
      user,
    });
  } catch (err) {
    console.error('[user/profile PATCH]', err);
    const status = err.code === 'PHONE_ALREADY_REGISTERED'
      || err.code === 'INVALID_PHONE'
      || err.code === 'INVALID_NAME'
      ? 400
      : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to update profile',
      code: err.code || 'PROFILE_UPDATE_FAILED',
    });
  }
});

router.get('/wallet/deposit-addresses', requireAuth, async (req, res) => {
  try {
    const settings = await getUsdtDepositSettings();
    const { isTronDepositEnabled } = require('../services/securityFlags');
    let trc20Address = settings.usdt_trc20_address;
    let trc20Source = 'shared';
    if (isTronDepositEnabled()) {
      try {
        const { generateUserDepositAddress } = require('../services/tronWalletService');
        const assigned = await generateUserDepositAddress(req.user.id);
        if (assigned?.address) {
          trc20Address = assigned.address;
          trc20Source = assigned.source || 'hd';
        }
      } catch (err) {
        console.warn('[user/wallet/deposit-addresses] HD resolve skipped:', err.message);
      }
    }
    res.json({
      usdt_trc20_address: trc20Address,
      usdt_bep20_address: null,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
      trc20_address_source: trc20Source,
      deposit_provider: 'tron-hd',
      networks: [
        { id: 'TRC20', label: 'TRC20 (Tron)', address: trc20Address, source: trc20Source },
      ],
    });
  } catch (err) {
    console.error('[user/wallet/deposit-addresses]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/wallet', requireAuth, requireSensitive, async (req, res) => {
  try {
    // Balance checks must never be served from HTTP/CDN caches.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');

    let user = await User.findById(req.user.id);
    let legacyMigration = { migrated: false };
    // Skip migrate work for the common case (legacy USD already cleared).
    if (Number(user?.balance ?? 0) > 0.001) {
      legacyMigration = await migrateLegacyUsdToMmk(req.user.id);
      user = await User.findById(req.user.id);
    }

    // Mirror ensure is non-blocking — balances come from Turso (+ cached overlay).
    ensureSupabaseUserWalletInBackground(req.user.id);

    const localPayload = {
      ...walletPayload(user),
      email: user.email || req.user.email,
      updated_at: user.updated_at || null,
      source: 'turso',
    };
    // Prefer Turso for instant home balances after login. Use ?fresh=1 to force a
    // Supabase Table Editor re-read (still honors the short read timeout + row cache).
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    let balances = localPayload;
    if (fresh) {
      balances = await overlayWalletPayloadFromSupabase(req.user.id, {
        ...localPayload,
        fresh: true,
      });
    } else {
      // Warm Supabase cache in the background — do not block login hydration.
      try {
        const { fetchFreshUserWalletRow } = require('../services/supabaseWalletReadService');
        fetchFreshUserWalletRow(req.user.id, { email: localPayload.email }).catch(() => {});
      } catch (_) { /* ignore */ }
    }
    res.json({
      user_id: user.id,
      ...balances,
      balance: balances.balance_mmk ?? user.balance_mmk ?? 0,
      currency: 'MMK',
      legacy_migration: legacyMigration.migrated ? legacyMigration : null,
    });
  } catch (err) {
    console.error('[user/wallet]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/card', requireAuth, requireSensitive, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const payload = await getUserCardsPayload(req.user.id);

    if (!payload.cards.length) {
      return res.status(404).json({ error: 'No card issued for this user', cards: [] });
    }

    res.json({
      user: { id: user.id, name: user.name },
      card: payload.cards[payload.active_index],
      cards: payload.cards,
      active_index: payload.active_index,
    });
  } catch (err) {
    console.error('[user/card]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function sendPagoError(res, err, fallback) {
  const status = err.code === 'INSUFFICIENT_USDT_BALANCE'
    ? 400
    : (err.status || 500);
  res.status(status).json({
    success: false,
    error: err.message || fallback,
    code: err.code || 'PAGO_ERROR',
    pago_card_id: err.pago_card_id || undefined,
    detail: err.detail || undefined,
  });
}

router.post('/cards/request', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const { issuePagoCardForUser, PAGO_PRODUCTS } = require('../services/pagoCardService');
    const result = await issuePagoCardForUser({
      userId: req.user.id,
      productCode: req.body?.product_code,
      firstName: req.body?.first_name,
      lastName: req.body?.last_name,
      email: req.body?.email,
      initialLoad: req.body?.initial_load,
    });
    const payload = await getUserCardsPayload(req.user.id);
    const card = payload.cards.find((item) => Number(item.id) === Number(result.card?.id)) || null;
    res.status(201).json({
      success: true,
      message: 'Your virtual card is ready.',
      products: PAGO_PRODUCTS,
      debited_usdt: result.debited_usdt,
      card,
      ...payload,
    });
  } catch (err) {
    console.error('[user/cards/request]', err.code || err.message);
    sendPagoError(res, err, 'Failed to request a virtual card');
  }
});

/**
 * Reconcile provider-issued Pago cards into local cards_v2.
 * Body may include pago_card_id to import one orphaned card by id.
 */
router.post('/cards/sync', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const { syncPagoCardsForUser } = require('../services/pagoCardService');
    const result = await syncPagoCardsForUser(req.user.id, {
      pagoCardId: req.body?.pago_card_id || req.body?.card_id || null,
    });
    const payload = await getUserCardsPayload(req.user.id);
    const message = result.imported > 0
      ? `Imported ${result.imported} card${result.imported === 1 ? '' : 's'} from Pago Card.`
      : (result.updated > 0
        ? 'Card details refreshed from Pago Card.'
        : 'No new Pago cards to import.');
    res.json({
      success: true,
      message,
      imported: result.imported || 0,
      updated: result.updated || 0,
      ...payload,
      card: payload.cards.length ? payload.cards[payload.active_index] : null,
    });
  } catch (err) {
    console.error('[user/cards/sync]', err.code || err.message);
    sendPagoError(res, err, 'Failed to sync Pago cards');
  }
});

router.get('/cards/products', requireAuth, (_req, res) => {
  const { PAGO_PRODUCTS } = require('../services/pagoCardService');
  res.json({ products: PAGO_PRODUCTS });
});

/** All recent 3DS codes across the user's Pago cards (must be before /cards/:id). */
router.get('/cards/3ds', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const { listUser3dsEvents } = require('../services/pago3dsWebhookService');
    const events = await listUser3dsEvents(req.user.id, { limit: 30 });
    res.json({
      success: true,
      latest: events.find((item) => item.otp) || events[0] || null,
      events,
    });
  } catch (err) {
    console.error('[user/cards/3ds-list]', err.code || err.message);
    sendPagoError(res, err, 'Failed to load 3DS codes');
  }
});

router.post('/cards/3ds/:eventId/seen', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const eventId = parseInt(req.params.eventId, 10);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_EVENT_ID' });
    }
    const { markUser3dsSeen } = require('../services/pago3dsWebhookService');
    const event = await markUser3dsSeen(req.user.id, eventId);
    if (!event) return res.status(404).json({ error: 'Event not found', code: 'EVENT_NOT_FOUND' });
    res.json({ success: true, event });
  } catch (err) {
    console.error('[user/cards/3ds/seen]', err.code || err.message);
    sendPagoError(res, err, 'Failed to mark 3DS code seen');
  }
});

router.get('/cards/:id', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const cardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'Invalid card id', code: 'INVALID_CARD_ID' });
    }
    const { refreshPagoCard } = require('../services/pagoCardService');
    await refreshPagoCard(req.user.id, cardId);
    const payload = await getUserCardsPayload(req.user.id);
    const card = payload.cards.find((item) => Number(item.id) === cardId);
    if (!card) return res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
    res.json({ card, ...payload });
  } catch (err) {
    console.error('[user/cards/detail]', err.code || err.message);
    sendPagoError(res, err, 'Failed to load card details');
  }
});

/**
 * Wallet add capability for a card. Pago supports Apple/Google Pay at the
 * network level but has no public push-provisioning API — clients use the
 * guided manual-add flow with revealed PAN/expiry/CVV.
 */
router.get('/cards/:id/wallet', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const cardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'Invalid card id', code: 'INVALID_CARD_ID' });
    }
    const payload = await getUserCardsPayload(req.user.id);
    const card = payload.cards.find((item) => Number(item.id) === cardId);
    if (!card) return res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });
    const { getWalletProvisioningInfo } = require('../services/pagoCardService');
    const wallet = getWalletProvisioningInfo(card);
    res.json({
      success: true,
      card_id: card.id,
      last4: card.last4,
      brand: card.brand,
      product_code: card.product_code,
      has_pan: Boolean(card.card_number),
      has_cvv: Boolean(card.cvv),
      wallet,
    });
  } catch (err) {
    console.error('[user/cards/wallet]', err.code || err.message);
    sendPagoError(res, err, 'Failed to load wallet add options');
  }
});

/**
 * Recent Pagocards 3DS verification codes for a card (webhook-fed).
 */
router.get('/cards/:id/3ds', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const cardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'Invalid card id', code: 'INVALID_CARD_ID' });
    }
    const payload = await getUserCardsPayload(req.user.id);
    const card = payload.cards.find((item) => Number(item.id) === cardId);
    if (!card) return res.status(404).json({ error: 'Card not found', code: 'CARD_NOT_FOUND' });

    const { listUser3dsEvents } = require('../services/pago3dsWebhookService');
    const events = await listUser3dsEvents(req.user.id, {
      localCardId: cardId,
      pagoCardId: card.pago_card_id || null,
      limit: 20,
    });
    const latest = events.find((item) => item.otp) || events[0] || null;
    res.json({
      success: true,
      card_id: cardId,
      pago_card_id: card.pago_card_id || null,
      latest,
      events,
    });
  } catch (err) {
    console.error('[user/cards/3ds]', err.code || err.message);
    sendPagoError(res, err, 'Failed to load 3DS codes');
  }
});

router.post('/cards/:id/topup', requireAuth, requireSensitive, async (req, res) => {
  try {
    setCardsNoStore(res);
    const cardId = parseInt(req.params.id, 10);
    if (!Number.isFinite(cardId) || cardId <= 0) {
      return res.status(400).json({ error: 'Invalid card id', code: 'INVALID_CARD_ID' });
    }
    const amount = req.body?.amount_usdt ?? req.body?.amount ?? req.body?.top_up_usd;
    const { topUpPagoCard } = require('../services/pagoCardService');
    const result = await topUpPagoCard({
      userId: req.user.id,
      localCardId: cardId,
      amountUsd: amount,
    });
    const payload = await getUserCardsPayload(req.user.id);
    const card = payload.cards.find((item) => Number(item.id) === cardId) || null;
    res.json({
      success: true,
      message: `Card topped up with $${Number(result.funded_usd).toFixed(2)}. Wallet debit ${Number(result.debited_usdt).toFixed(2)} USDT.`,
      debited_usdt: result.debited_usdt,
      funded_usd: result.funded_usd,
      reload_fee_usd: result.reload_fee_usd,
      transaction_id: result.transaction_id,
      card,
      ...payload,
    });
  } catch (err) {
    console.error('[user/cards/topup]', err.code || err.message);
    sendPagoError(res, err, 'Failed to top up the card');
  }
});

router.post('/card/reload', requireAuth, requireSensitive, async (req, res) => {
  try {
    const cardId = parseInt(req.body?.card_id, 10);
    const amount = req.body?.amount_usdt ?? req.body?.amount ?? req.body?.top_up_usd;
    const { topUpPagoCard } = require('../services/pagoCardService');
    const result = await topUpPagoCard({
      userId: req.user.id,
      localCardId: cardId,
      amountUsd: amount,
    });
    res.json({
      success: true,
      message: `Card topped up with $${Number(result.funded_usd).toFixed(2)}. Wallet debit ${Number(result.debited_usdt).toFixed(2)} USDT.`,
      debited_usdt: result.debited_usdt,
      funded_usd: result.funded_usd,
      reload_fee_usd: result.reload_fee_usd,
      transaction_id: result.transaction_id,
    });
  } catch (err) {
    console.error('[user/card/reload]', err.code || err.message);
    sendPagoError(res, err, 'Failed to top up the card');
  }
});

router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const transactions = await TransactionLog.findByUserId(req.user.id, { limit: 100 });
    res.json({ transactions });
  } catch (err) {
    console.error('[user/transactions]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reloads', requireAuth, async (req, res) => {
  try {
    const rows = await CardReloadRequest.findByUserId(req.user.id);
    res.json({
      reloads: rows.map((row) => CardReloadRequest.mapForClient(row)),
    });
  } catch (err) {
    console.error('[user/reloads]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/deposits', requireAuth, async (req, res) => {
  try {
    const deposits = await DepositRequest.findByUserId(req.user.id);
    res.json({ deposits });
  } catch (err) {
    console.error('[user/deposits]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legacy alias — owner-only
router.get('/card/:user_id', requireAuth, requireSensitive, async (req, res) => {
  if (parseInt(req.params.user_id, 10) !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const user = await User.findById(req.user.id);
    const db = getDb();
    let card = await Card.findPrimaryByUserId(req.user.id);
    if (!card) card = await db.get('SELECT * FROM cards WHERE user_id = ?', req.user.id);
    if (!card) return res.status(404).json({ error: 'No card issued for this user' });
    res.json({
      user: { id: user.id, name: user.name },
      card: {
        id: card.id,
        card_number: card.card_number,
        exp_date: card.exp_date,
        cvv: card.cvv,
        card_holder_name: card.card_holder_name,
        created_at: card.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:user_id', requireAuth, async (req, res) => {
  if (parseInt(req.params.user_id, 10) !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const user = await User.findById(req.user.id);
    res.json({
      user: mapPublicUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use('/usdt-wallet', require('./usdtWallet'));

module.exports = router;
