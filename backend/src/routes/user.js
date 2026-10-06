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
  const last4 = digits.length >= 4 ? digits.slice(-4) : '????';

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
    balance_usd: metadata.balance_usd ?? null,
    // Bitnob / Standard providers are retired — never expose them to clients.
    provider: (() => {
      const p = String(metadata.provider || '').toLowerCase();
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

router.get('/cards', requireAuth, requireSensitive, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const payload = await getUserCardsPayload(req.user.id);

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

router.post('/card/reload', requireAuth, requireSensitive, (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'Virtual card funding is no longer available.',
    code: 'CARD_FEATURES_REMOVED',
  });
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
