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
  calculateCardRequestPricing,
  calculateCardReloadPricing,
  calculateCardRequestPricingUsdt,
  calculateCardReloadPricingUsdt,
  getUsdtDepositSettings,
  getWithdrawalFeeSettings,
  parseRecordMetadata,
  getCurrentRateSummary,
  buildRateSnapshot,
} = require('../services/settingsService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { createDepositRequest } = require('../services/depositService');
const { RELOAD_PENDING_MESSAGE } = require('../services/cardReloadApprovalService');
const { walletPayload, formatMmk, formatUsdt, migrateLegacyUsdToMmk } = require('../services/walletService');
const {
  purchaseCardFromWallet,
  reloadCardFromWallet,
  purchaseCardFromUsdtWallet,
  reloadCardFromUsdtWallet,
} = require('../services/cardWalletService');
const { resolveActivePaymentMethod } = require('../services/depositPaymentMethodService');
const {
  isPendingCardRecord,
  normalizeCardStatus,
  displayStatusLabel,
  isCardReloadAllowed,
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

async function getUserCardsPayload(userId) {
  const db = getDb();
  let cards = await Card.findByUserId(userId);
  cards = cards.filter((c) => !['cancelled', 'expired'].includes(String(c.status || '').toLowerCase()));

  if (!cards.length) {
    const legacy = await db.get('SELECT * FROM cards WHERE user_id = ?', userId);
    if (legacy) {
      cards = [{
        ...legacy,
        status: 'active',
        is_primary: 1,
        metadata: null,
      }];
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

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      user: {
        ...User.stripPrivate(user),
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

router.get('/wallet/deposit-addresses', requireAuth, async (_req, res) => {
  try {
    const settings = await getUsdtDepositSettings();
    res.json({
      usdt_trc20_address: settings.usdt_trc20_address,
      usdt_bep20_address: settings.usdt_bep20_address,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
      networks: [
        { id: 'TRC20', label: 'TRC20 (Tron)', address: settings.usdt_trc20_address },
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
    const legacyMigration = await migrateLegacyUsdToMmk(req.user.id);
    const user = await User.findById(req.user.id);
    res.json({
      user_id: user.id,
      ...walletPayload(user),
      balance: user.balance_mmk ?? 0,
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
    res.json({
      card_issuance_fee_usd: settings.card_issuance_fee_usd,
      minimum_initial_deposit_usd: settings.minimum_initial_deposit_usd,
      card_reload_fee_usd: settings.card_reload_fee_usd,
      card_reload_provider_cost_usd: settings.card_reload_provider_cost_usd,
      card_reload_net_profit_usd: settings.card_reload_net_profit_usd,
      minimum_card_reload_mmk: settings.minimum_card_reload_mmk,
      minimum_usdt_deposit: settings.minimum_usdt_deposit,
      minimum_usdt_reload: settings.minimum_usdt_reload,
      mmk_to_usd_rate: settings.mmk_to_usd_rate,
      rate_effective_date: currentRate.effective_date,
      rate_label: "Today's Daily Exchange Rate",
      currency: 'USD',
      withdrawal_fees: await getWithdrawalFeeSettings(),
    });
  } catch (err) {
    console.error('[user/card/pricing]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/card/request', requireAuth, requireSensitive, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const payFromWallet = Boolean(req.body.pay_from_wallet);
    const walletType = (req.body.wallet_type || 'mmk').toLowerCase();

    if (payFromWallet && walletType === 'usdt') {
      const result = await purchaseCardFromUsdtWallet(req.user.id, {
        initialLoadUsd: parseFloat(req.body.initial_load_usd),
        cardHolderName: req.body.card_holder_name || user.name,
        note: req.body.note,
      });
      return res.json({
        success: true,
        paid_from_wallet: true,
        pending: true,
        wallet_type: 'usdt',
        message: result.message,
        card: mapCardForClient(result.card),
        card_request_id: result.card?.id,
        pricing_breakdown: {
          ...result.pricing,
          payment_method: 'USDT Wallet',
        },
        wallet: {
          debited_usdt: result.wallet_debit_usdt,
          balance_usdt: result.balance_usdt,
          usdt_formatted: formatUsdt(result.balance_usdt),
        },
      });
    }

    if (payFromWallet) {
      const result = await purchaseCardFromWallet(req.user.id, {
        initialLoadUsd: parseFloat(req.body.initial_load_usd),
        cardHolderName: req.body.card_holder_name || user.name,
        note: req.body.note,
      });
      return res.json({
        success: true,
        paid_from_wallet: true,
        pending: true,
        wallet_type: 'mmk',
        message: result.message,
        card: mapCardForClient(result.card),
        card_request_id: result.card?.id,
        pricing_breakdown: {
          initial_load_usd: result.pricing.initial_load_usd,
          issuance_fee_usd: result.pricing.issuance_fee_usd,
          total_usd_required: result.pricing.total_usd_required,
          total_mmk: result.pricing.total_mmk,
          mmk_to_usd_rate: result.pricing.mmk_to_usd_rate,
          payment_method: 'Main MMK Wallet',
        },
        wallet: {
          debited_mmk: result.wallet_debit_mmk,
          balance_mmk: result.balance_mmk,
          mmk_formatted: formatMmk(result.balance_mmk),
        },
      });
    }

    const pending = await Card.findByUserId(req.user.id, { status: 'pending' });

    if (pending.length) {
      const existing = pending[0];
      const meta = parseRecordMetadata(existing.metadata);
      return res.status(400).json({
        error: 'You already have a pending card request',
        card: { id: existing.id, status: existing.status, created_at: existing.created_at },
        deposit_id: meta.deposit_id || null,
        pricing: meta.pricing || null,
      });
    }

    const settings = await getCardPricingSettings();
    const initialLoadUsd = parseFloat(req.body.initial_load_usd);

    let methodRow;
    try {
      methodRow = await resolveActivePaymentMethod({
        paymentMethodId: req.body.payment_method_id,
        paymentMethod: req.body.payment_method,
      });
    } catch (resolveErr) {
      return res.status(400).json({ error: resolveErr.message || 'Payment method unavailable' });
    }
    const paymentMethod = methodRow.bank_name;

    const pricing = calculateCardRequestPricing(initialLoadUsd, settings);
    const rateSnapshot = await buildRateSnapshot();

    const cardMetadata = {
      pricing,
      payment_method: paymentMethod,
      payment_method_id: methodRow.id,
      bank_account: {
        bank_name: methodRow.bank_name,
        account_name: methodRow.account_name,
        account_number: methodRow.account_number,
        method_type: methodRow.method_type,
      },
      requested_at: new Date().toISOString(),
      rate_snapshot: rateSnapshot,
    };

    const card = await Card.requestPending({
      userId: req.user.id,
      cardHolderName: req.body.card_holder_name || user.name,
      userNote: req.body.note,
      metadata: cardMetadata,
    });

    const depositMetadata = {
      purpose: 'card_issuance',
      card_request_id: card.id,
      pricing,
      rate_snapshot: rateSnapshot,
      payment_method_id: methodRow.id,
      bank_name: methodRow.bank_name,
      account_name: methodRow.account_name,
      account_number: methodRow.account_number,
      method_type: methodRow.method_type,
      qr_code_image_url: methodRow.qr_code_image_url,
    };

    const deposit = await createDepositRequest(req.user.id, {
      amount_mmk: pricing.total_mmk,
      amount_usd: pricing.total_usd_required,
      payment_method: paymentMethod,
      purpose: 'card_issuance',
      metadata: depositMetadata,
    });

    cardMetadata.deposit_id = deposit.id;
    cardMetadata.deposit_ref = deposit.ref_code;

    const db = getDb();
    await db.run(
      `UPDATE cards_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(cardMetadata),
      card.id
    );

    await TransactionLog.create({
      userId: req.user.id,
      type: 'card_request',
      direction: 'neutral',
      referenceType: 'cards_v2',
      referenceId: card.id,
      description: `New card request — load $${pricing.initial_load_usd.toFixed(2)} + fee $${pricing.issuance_fee_usd.toFixed(2)}`,
      createdBy: 'user',
      metadata: { pricing, deposit_id: deposit.id, deposit_ref: deposit.ref_code, payment_method_id: methodRow.id },
    });

    res.json({
      success: true,
      message: 'Card request created — complete payment using the reference code below',
      card: { id: card.id, status: card.status, created_at: card.created_at },
      deposit: enrichDeposit(deposit),
      pricing_breakdown: {
        initial_load_usd: pricing.initial_load_usd,
        issuance_fee_usd: pricing.issuance_fee_usd,
        total_usd_required: pricing.total_usd_required,
        total_mmk: pricing.total_mmk,
        mmk_to_usd_rate: pricing.mmk_to_usd_rate,
        payment_method: paymentMethod,
      },
      payment_method: methodRow,
      payment_instructions: {
        ref_code: deposit.ref_code,
        amount_mmk: pricing.total_mmk,
        message: `Send exactly ${pricing.total_mmk.toLocaleString()} MMK via ${paymentMethod}`,
        bank_name: methodRow.bank_name,
        account_name: methodRow.account_name,
        account_number: methodRow.account_number,
        method_type: methodRow.method_type,
        qr_code_image_url: methodRow.qr_code_image_url,
        qr_code_url: methodRow.qr_code_image_url
          || `/api/qr?size=200&data=${encodeURIComponent(methodRow.account_number)}`,
      },
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_MMK_BALANCE' || err.code === 'INSUFFICIENT_USDT_BALANCE') {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        required_mmk: err.required_mmk,
        available_mmk: err.available_mmk,
        required_usdt: err.required_usdt,
        available_usdt: err.available_usdt,
      });
    }
    if (err.message.includes('Minimum initial deposit') || err.message.includes('must be') || err.message.includes('pending')) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error('[user/card/request]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/card/reload', requireAuth, requireSensitive, async (req, res) => {
  try {
    const payFromWallet = Boolean(req.body.pay_from_wallet);
    const walletType = (req.body.wallet_type || 'mmk').toLowerCase();
    const cardId = parseInt(req.body.card_id, 10);

    if (payFromWallet && walletType === 'usdt') {
      const amountUsdt = parseFloat(req.body.amount_usdt);
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
    }

    const amountMmk = parseFloat(req.body.amount_mmk);

    if (payFromWallet) {
      const result = await reloadCardFromWallet(req.user.id, { cardId, amountMmk });
      return res.json({
        success: true,
        paid_from_wallet: true,
        pending: Boolean(result.pending),
        reload_request_id: result.reload_request_id,
        wallet_type: 'mmk',
        message: result.message,
        reload_request: result.reload_request,
        pricing_breakdown: result.pricing,
        wallet: {
          debited_mmk: result.wallet_debit_mmk,
          balance_mmk: result.balance_mmk,
          mmk_formatted: formatMmk(result.balance_mmk),
        },
      });
    }

    const paymentMethodRaw = req.body.payment_method || null;
    const paymentMethodId = req.body.payment_method_id || null;

    if (!cardId) {
      return res.status(400).json({ error: 'card_id is required — select a card to reload' });
    }

    let methodRow;
    try {
      methodRow = await resolveActivePaymentMethod({
        paymentMethodId,
        paymentMethod: paymentMethodRaw,
      });
    } catch (resolveErr) {
      return res.status(400).json({ error: resolveErr.message || 'Payment method unavailable' });
    }
    const paymentMethod = methodRow.bank_name;

    const card = await Card.findById(cardId);
    if (!card || card.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Card not found' });
    }
    if (!isCardReloadAllowed(card.status)) {
      return res.status(400).json({
        error: `Card is ${displayStatusLabel(card.status)} — only active cards can be reloaded`,
      });
    }

    const settings = await getCardPricingSettings();
    const pricing = calculateCardReloadPricing(amountMmk, settings);
    const mapped = mapCardForClient(card);
    const cardLabel = `**** **** **** ${mapped.last4} (Active)`;

    const depositMetadata = {
      card_id: cardId,
      card_label: cardLabel,
      card_last4: mapped.last4,
      payment_method: paymentMethod,
      payment_method_id: methodRow.id,
      bank_name: methodRow.bank_name,
      account_name: methodRow.account_name,
      account_number: methodRow.account_number,
      method_type: methodRow.method_type,
      qr_code_image_url: methodRow.qr_code_image_url,
      purpose: 'card_reload',
      pricing: {
        ...pricing,
        card_id: cardId,
        card_label: cardLabel,
        payment_method: paymentMethod,
      },
    };

    const deposit = await createDepositRequest(req.user.id, {
      amount_mmk: pricing.deposit_mmk,
      amount_usd: pricing.net_usd_to_card,
      payment_method: paymentMethod,
      purpose: 'card_reload',
      metadata: depositMetadata,
    });

    const reloadRequest = await CardReloadRequest.create({
      userId: req.user.id,
      cardId,
      walletType: 'mmk',
      amountMmk: pricing.deposit_mmk,
      netUsdToCard: pricing.net_usd_to_card,
      reloadFeeUsd: pricing.reload_fee_usd,
      grossUsd: pricing.gross_usd,
      pricing,
      depositId: deposit.id,
    });

    res.json({
      success: true,
      pending: true,
      reload_request_id: reloadRequest.id,
      message: RELOAD_PENDING_MESSAGE,
      deposit: enrichDeposit(deposit, settings),
      reload_request: CardReloadRequest.mapForClient({
        ...reloadRequest,
        card_number: card.card_number,
      }),
      pricing_breakdown: {
        ...pricing,
        card_id: cardId,
        card_label: cardLabel,
        payment_method: paymentMethod,
      },
      payment_method: methodRow,
      payment_instructions: {
        ref_code: deposit.ref_code,
        amount_mmk: pricing.deposit_mmk,
        message: `Send exactly ${pricing.deposit_mmk.toLocaleString()} MMK via ${paymentMethod}`,
        note: `Card reload — $${pricing.net_usd_to_card.toFixed(2)} USD top-up + $${pricing.reload_fee_usd.toFixed(2)} service fee (${pricing.deposit_mmk.toLocaleString()} MMK total)`,
        bank_name: methodRow.bank_name,
        account_name: methodRow.account_name,
        account_number: methodRow.account_number,
        method_type: methodRow.method_type,
        qr_code_image_url: methodRow.qr_code_image_url,
        qr_code_url: methodRow.qr_code_image_url
          || `/api/qr?size=200&data=${encodeURIComponent(methodRow.account_number)}`,
      },
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_MMK_BALANCE' || err.code === 'INSUFFICIENT_USDT_BALANCE') {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        required_mmk: err.required_mmk,
        available_mmk: err.available_mmk,
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
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use('/usdt-wallet', require('./usdtWallet'));

module.exports = router;
