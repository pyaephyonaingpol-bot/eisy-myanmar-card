const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const DepositRequest = require('../models/DepositRequest');
const { enrichDeposit } = require('../services/depositEnrichment');
const {
  getCardPricingSettings,
  getUsdtDepositSettings,
  getWithdrawalFeeSettings,
  getDepositFeeSettings,
  parseRecordMetadata,
  getCurrentRateSummary,
} = require('../services/settingsService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { walletPayload, formatUsdt, migrateLegacyUsdToMmk } = require('../services/walletService');
const { overlayWalletPayloadFromSupabase } = require('../services/supabaseWalletReadService');
const { ensureSupabaseUserWallet } = require('../services/supabaseSyncService');
const {
  purchaseCardFromUsdtWallet,
  reloadCardFromUsdtWallet,
  getKripicardBinOptions,
} = require('../services/cardWalletService');
const { assignCardToUser, isSupabaseAdminEnabled } = require('../services/cardPoolService');
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
    created_at: c.created_at,
    activated_at: metadata.activated_at || c.activated_at || null,
    label: pending ? 'Pending request' : `Card •••• ${last4}${c.is_primary ? ' (Primary)' : ''}`,
    last4,
  };
}

function respondCardPurchaseError(res, err, logTag) {
  if (err.code === 'INSUFFICIENT_USDT_BALANCE') {
    return res.status(400).json({
      error: err.message,
      code: err.code,
      required_usdt: err.required_usdt,
      available_usdt: err.available_usdt,
    });
  }
  if (
    err.code === 'USDT_ONLY_CARD_ISSUANCE'
    || err.code === 'INVALID_BIN'
    || err.code === 'INVALID_NAME_ON_CARD'
    || err.code === 'INVALID_AMOUNT'
    || err.code === 'KRIPICARD_NOT_CONFIGURED'
    || err.code === 'SUPABASE_NOT_CONFIGURED'
  ) {
    const status = (err.code === 'KRIPICARD_NOT_CONFIGURED' || err.code === 'SUPABASE_NOT_CONFIGURED')
      ? 503
      : 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  if (
    err.code === 'KRIPICARD_HTTP_ERROR'
    || err.code === 'KRIPICARD_API_ERROR'
    || err.code === 'KRIPICARD_TIMEOUT'
    || err.code === 'KRIPICARD_BAD_RESPONSE'
    || err.code === 'KRIPICARD_MISSING_CARD_ID'
  ) {
    return res.status(502).json({
      error: err.message || 'Card provider issuance failed',
      code: err.code,
      provider_status: err.status,
      refunded: !err.refund_failed,
    });
  }
  if (err.message.includes('Minimum initial deposit') || err.message.includes('must be') || err.message.includes('pending')) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error(`[${logTag}]`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

function buildCardPurchaseSuccessPayload(result) {
  return {
    success: true,
    paid_from_wallet: true,
    pending: Boolean(result.pending),
    issued: Boolean(result.issued),
    wallet_type: 'usdt',
    message: result.message,
    card: mapCardForClient(result.card),
    card_request_id: result.card?.id,
    provider_card_id: result.provider_card_id || null,
    bin: result.bin || null,
    pricing_breakdown: {
      ...result.pricing,
      payment_method: 'USDT Wallet',
    },
    wallet: {
      debited_usdt: result.wallet_debit_usdt,
      balance_usdt: result.balance_usdt,
      usdt_formatted: formatUsdt(result.balance_usdt),
    },
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

/**
 * Pool Model — assign an available Kripicard from card_pools → user_cards.
 * Mirrors Next.js route: app/api/cards/purchase/route.js
 */
router.post('/cards/purchase', requireAuth, requireSensitive, async (req, res) => {
  try {
    if (!isSupabaseAdminEnabled()) {
      return res.status(503).json({
        error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }

    const body = req.body || {};
    const purchaseAmount =
      body.purchase_amount != null
        ? Number(body.purchase_amount)
        : body.amount != null
          ? Number(body.amount)
          : null;

    const result = await assignCardToUser({
      userId: req.user.id,
      purchaseAmount: Number.isFinite(purchaseAmount) ? purchaseAmount : null,
      purchaseCurrency: body.purchase_currency || body.currency || null,
      cardholderName: body.cardholder_name || body.cardHolderName || req.user.name || null,
      metadata: {
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
        source: 'user/cards/purchase',
        assigned_via: 'user',
      },
    });

    const card = result.user_card || {};
    res.json({
      success: true,
      message: 'Card assigned successfully',
      card: {
        id: card.id,
        user_id: card.user_id,
        card_id: card.card_id,
        card_number: card.card_number,
        cvv: card.cvv,
        exp_date: card.exp_date,
        cardholder_name: card.cardholder_name,
        brand: card.brand,
        currency: card.currency,
        balance: card.balance,
        status: card.status,
        purchase_amount: card.purchase_amount,
        purchase_currency: card.purchase_currency,
        created_at: card.created_at,
      },
      pool_card_id: result.pool_card?.id || null,
    });
  } catch (err) {
    console.error('[user/cards/purchase]', err);
    const code = err.code || 'INTERNAL_ERROR';
    const status =
      code === 'USER_REQUIRED' ? 400
        : code === 'POOL_EMPTY' || code === 'POOL_RACE' || code === 'ALREADY_ASSIGNED' ? 409
          : 500;
    res.status(status).json({ error: err.message || 'Purchase failed', code });
  }
});

/**
 * Real-time Kripicard issuance with profit markup.
 * Debits USDT wallet (card load + admin markup), sends only card load to Kripicard,
 * and records markup in platform_fee_events.
 * Mirrors Next.js route: app/api/cards/issue/route.js
 */
router.post('/cards/issue', requireAuth, requireSensitive, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const body = req.body || {};
    const initialLoadUsd = parseFloat(
      body.initial_load_usd ?? body.amount ?? body.purchase_amount ?? body.initial_amount
    );

    const result = await purchaseCardFromUsdtWallet(req.user.id, {
      initialLoadUsd,
      cardHolderName: body.name_on_card || body.cardholder_name || body.cardHolderName || user.name,
      note: body.note,
      bin: body.bin ?? body.bank_bin ?? body.bankBin,
      paymentRef: body.payment_ref || body.paymentRef || body.idempotency_key || body.idempotencyKey || null,
    });

    res.json({
      ...buildCardPurchaseSuccessPayload(result),
      reused: false,
    });
  } catch (err) {
    return respondCardPurchaseError(res, err, 'user/cards/issue');
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
    let trc20Address = settings.usdt_trc20_address;
    let trc20Source = 'shared';
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
    res.json({
      usdt_trc20_address: trc20Address,
      usdt_bep20_address: settings.usdt_bep20_address,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
      trc20_address_source: trc20Source,
      networks: [
        { id: 'TRC20', label: 'TRC20 (Tron)', address: trc20Address, source: trc20Source },
        { id: 'BEP20', label: 'BEP20 (BSC)', address: settings.usdt_bep20_address },
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

    try {
      await ensureSupabaseUserWallet(req.user.id);
    } catch (err) {
      console.warn('[user/wallet] Supabase wallet ensure skipped:', err.message);
    }

    const localPayload = {
      ...walletPayload(user),
      email: user.email || req.user.email,
      updated_at: user.updated_at || null,
    };
    // Prefer a fresh Supabase read so Table Editor edits show immediately.
    // If Turso is newer (admin Adjust USDT), overlay keeps the Turso balance.
    const balances = await overlayWalletPayloadFromSupabase(req.user.id, localPayload);
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

router.get('/card/pricing', requireAuth, async (_req, res) => {
  try {
    const settings = await getCardPricingSettings();
    const currentRate = await getCurrentRateSummary();
    const bins = getKripicardBinOptions();
    res.json({
      card_issuance_fee_usd: settings.card_issuance_fee_usd,
      platform_markup_usd: settings.card_issuance_fee_usd,
      minimum_initial_deposit_usd: settings.minimum_initial_deposit_usd,
      card_reload_fee_usd: settings.card_reload_fee_usd,
      card_reload_provider_cost_usd: settings.card_reload_provider_cost_usd,
      card_reload_net_profit_usd: settings.card_reload_net_profit_usd,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
      minimum_usdt_reload: settings.minimum_usdt_reload,
      // MMK rate is for withdrawals only — not used for card issuance or reloads.
      mmk_to_usd_rate: settings.mmk_to_usd_rate,
      rate_effective_date: currentRate.effective_date,
      rate_label: "Today's Daily Exchange Rate",
      currency: 'USD',
      payment_currency: 'USDT',
      card_issuance_payment: 'usdt_wallet',
      card_issuance_rate: '1 USDT ≈ 1 USD',
      exchange_rate_applied: false,
      auto_issue: true,
      kripicard_default_bin: bins.default_bin,
      kripicard_bins: bins.bins,
      kripicard_bins_source: bins.source,
      withdrawal_fees: await getWithdrawalFeeSettings(),
      deposit_fees: await getDepositFeeSettings(),
    });
  } catch (err) {
    console.error('[user/card/pricing]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/card/request', requireAuth, requireSensitive, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const walletType = String(req.body.wallet_type || 'usdt').toLowerCase();

    // Card purchase always debits USDT and auto-issues via Kripicard.
    // Reject any leftover MMK / bank payment flags from older clients.
    if (walletType && walletType !== 'usdt') {
      return res.status(400).json({
        error: 'Card issuance accepts USDT wallet payment only. MMK wallet and KBZPay/WavePay are not supported for new cards.',
        code: 'USDT_ONLY_CARD_ISSUANCE',
      });
    }

    const result = await purchaseCardFromUsdtWallet(req.user.id, {
      initialLoadUsd: parseFloat(req.body.initial_load_usd),
      cardHolderName: req.body.name_on_card || req.body.card_holder_name || user.name,
      note: req.body.note,
      bin: req.body.bin ?? req.body.bank_bin ?? req.body.bankBin,
      paymentRef: req.body.payment_ref || req.body.idempotency_key || null,
    });

    return res.json(buildCardPurchaseSuccessPayload(result));
  } catch (err) {
    return respondCardPurchaseError(res, err, 'user/card/request');
  }
});

router.post('/card/reload', requireAuth, requireSensitive, async (req, res) => {
  try {
    const walletType = String(req.body.wallet_type || 'usdt').toLowerCase();
    const cardId = parseInt(req.body.card_id, 10);
    const amountUsdt = parseFloat(req.body.amount_usdt);

    if (walletType !== 'usdt' || req.body.amount_mmk != null) {
      return res.status(400).json({
        error: 'Card reload accepts USDT wallet payment only. MMK wallet and KBZPay/WavePay are not supported.',
        code: 'USDT_ONLY_CARD_RELOAD',
      });
    }

    if (req.body.pay_from_wallet === false || req.body.payment_method || req.body.payment_method_id) {
      return res.status(400).json({
        error: 'Card reload accepts USDT wallet payment only.',
        code: 'USDT_ONLY_CARD_RELOAD',
      });
    }

    if (!cardId) {
      return res.status(400).json({ error: 'card_id is required — select a card to reload' });
    }

    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      return res.status(400).json({ error: 'Positive amount_usdt is required' });
    }

    const result = await reloadCardFromUsdtWallet(req.user.id, { cardId, amountUsdt });
    return res.json({
      success: true,
      paid_from_wallet: true,
      pending: Boolean(result.pending),
      reload_request_id: result.reload_request_id,
      wallet_type: 'usdt',
      message: result.message,
      reload_request: result.reload_request,
      pricing_breakdown: result.pricing,
      wallet: {
        debited_usdt: result.wallet_debit_usdt,
        balance_usdt: result.balance_usdt,
        usdt_formatted: formatUsdt(result.balance_usdt),
      },
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_USDT_BALANCE') {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        required_usdt: err.required_usdt,
        available_usdt: err.available_usdt,
      });
    }
    if (err.message.includes('Minimum') || err.message.includes('Amount') || err.message.includes('too small')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[user/card/reload]', err);
    res.status(500).json({ error: 'Internal server error' });
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
