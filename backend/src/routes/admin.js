const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireSensitive, requireAdmin, requireAdminOnly } = require('../middleware/auth');
const Card = require('../models/Card');
const CardReloadRequest = require('../models/CardReloadRequest');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const { creditDepositAndVerify } = require('../services/depositService');
const { enrichDeposit } = require('../services/depositEnrichment');
const {
  getAllSettings,
  getCardPricingSettings,
  getCurrentRateSummary,
  listExchangeRateHistory,
  updateSettings,
  parseRecordMetadata,
} = require('../services/settingsService');
const { getSystemLedgerSummary } = require('../services/ledgerSummaryService');
const {
  applyCardTransaction,
  mapCardForAdmin,
  getCardBalance,
} = require('../services/cardBalanceService');
const { approvePendingCardRequest } = require('../services/cardApprovalService');
const { approveP2pUsdtDeposit, isP2pDeposit } = require('../services/p2pDepositService');
const {
  releaseP2pBuyOrder,
  rejectP2pBuyOrder,
  listP2pBuyOrdersForAdmin,
} = require('../services/p2pBuyOrderService');
const {
  rejectP2pSellOrder,
  listP2pSellOrdersForAdmin,
} = require('../services/p2pSellOrderService');
const { getRevenueDashboard } = require('../services/revenueAnalyticsService');
const {
  listP2pAdminTransactions,
  listCardReloadAdminTransactions,
} = require('../services/adminLedgerTransactionService');
const {
  listKycSubmissionsForAdmin,
  approveKyc,
  rejectKyc,
} = require('../services/kycService');
const {
  listDisputedOrdersForAdmin,
  resolveDispute,
} = require('../services/p2pDisputeService');
const {
  listOrderMessagesForAdmin,
  postAdminOrderMessage,
} = require('../services/p2pOrderChatService');
const { uploadP2pAttachment, publicP2pUploadPath } = require('../middleware/upload');
const {
  listPendingReloadRequests,
  approvePendingReload,
  rejectPendingReload,
} = require('../services/cardReloadApprovalService');
const {
  updateCardLifecycleStatus,
  listIssuedCardsForAdmin,
} = require('../services/cardStatusService');
const { adjustMmk, adjustUsdt, formatMmk, formatUsdt } = require('../services/walletService');

const router = express.Router();

// ─── User self-service issue card (legacy dashboard) ───
router.post('/issue-card', requireAuth, requireSensitive, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.body.user_id ? parseInt(req.body.user_id, 10) : req.user.id;

    if (userId !== req.user.id && !req.isAdmin) {
      return res.status(403).json({ error: 'Can only issue card for your own account' });
    }

    const { card_number, exp_date, cvv, card_holder_name } = req.body;

    if (!card_number || !exp_date || !cvv) {
      return res.status(400).json({ error: 'card_number, exp_date, and cvv are required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const holderName = card_holder_name || user.name;

    let card = await Card.findPrimaryByUserId(userId);
    if (card) {
      card = await Card.updateCardDetails(card.id, {
        cardNumber: card_number,
        expDate: exp_date,
        cvv,
        cardHolderName: holderName,
        status: 'active',
        adminNotes: 'Updated via dashboard',
      });
    } else {
      card = await Card.issue({
        userId,
        cardNumber: card_number,
        expDate: exp_date,
        cvv,
        cardHolderName: holderName,
        status: 'active',
        isPrimary: true,
      });
    }

    const existingLegacy = await db.get('SELECT id FROM cards WHERE user_id = ?', userId);
    if (existingLegacy) {
      await db.run(`
        UPDATE cards SET card_number = ?, exp_date = ?, cvv = ?, card_holder_name = ? WHERE user_id = ?
      `, card_number, exp_date, cvv, holderName, userId);
    } else {
      await db.run(`
        INSERT INTO cards (user_id, card_number, exp_date, cvv, card_holder_name) VALUES (?, ?, ?, ?, ?)
      `, userId, card_number, exp_date, cvv, holderName);
    }

    await TransactionLog.create({
      userId,
      type: 'card_issued',
      direction: 'neutral',
      referenceType: 'cards_v2',
      referenceId: card.id,
      description: 'Virtual card issued or updated',
      createdBy: req.isAdmin ? 'admin' : 'user',
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Virtual card issued successfully',
      card: {
        id: card.id,
        user_id: userId,
        card_number: card.card_number,
        exp_date: card.exp_date,
        cvv: card.cvv,
        card_holder_name: card.card_holder_name,
        status: card.status,
      },
    });
  } catch (err) {
    console.error('[admin/issue-card]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin-only routes ───
router.use(requireAdminOnly);

router.get('/ledger-summary', async (_req, res) => {
  try {
    const summary = await getSystemLedgerSummary();
    res.json({ summary });
  } catch (err) {
    console.error('[admin/ledger-summary GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    const settings = await getAllSettings();
    const pricing = await getCardPricingSettings();
    const currentRate = await getCurrentRateSummary();
    const ledgerSummary = await getSystemLedgerSummary();
    res.json({
      settings,
      pricing: {
        card_issuance_fee_usd: pricing.card_issuance_fee_usd,
        minimum_initial_deposit_usd: pricing.minimum_initial_deposit_usd,
        card_reload_fee_usd: pricing.card_reload_fee_usd,
        minimum_card_reload_mmk: pricing.minimum_card_reload_mmk,
        mmk_to_usd_rate: pricing.mmk_to_usd_rate,
        rate_effective_date: pricing.rate_effective_date,
        p2p_seller_fee_percent: pricing.p2p_seller_fee_percent,
        platform_usdt_revenue_balance: pricing.platform_usdt_revenue_balance,
        usdt_withdraw_fee_trc20: pricing.usdt_withdraw_fee_trc20,
        usdt_withdraw_fee_bep20: pricing.usdt_withdraw_fee_bep20,
        usdt_withdraw_fee_trc20_type: pricing.usdt_withdraw_fee_trc20_type,
        usdt_withdraw_fee_bep20_type: pricing.usdt_withdraw_fee_bep20_type,
        usdt_withdraw_fee_bank: pricing.usdt_withdraw_fee_bank,
        usdt_withdraw_fee_bank_type: pricing.usdt_withdraw_fee_bank_type,
        minimum_usdt_withdrawal: pricing.minimum_usdt_withdrawal,
        minimum_mmk_withdrawal: pricing.minimum_mmk_withdrawal,
        mmk_withdraw_fee_percent: pricing.mmk_withdraw_fee_percent,
        payment_service_fee_percent: pricing.payment_service_fee_percent,
        payment_service_fee_minimum_usdt: pricing.payment_service_fee_minimum_usdt,
      },
      ledger_summary: ledgerSummary,
      current_rate: currentRate,
    });
  } catch (err) {
    console.error('[admin/settings GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const result = await updateSettings(req.body || {});
    res.json({
      success: true,
      message: 'Settings updated and rate history logged',
      pricing: result.pricing,
      current_rate: result.current_rate,
      history_entry: result.history_entry,
    });
  } catch (err) {
    console.error('[admin/settings PUT]', err);
    res.status(400).json({ error: err.message || 'Invalid settings' });
  }
});

router.get('/exchange-rate-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const history = await listExchangeRateHistory({ limit });
    const currentRate = await getCurrentRateSummary();
    res.json({ history, current_rate: currentRate });
  } catch (err) {
    console.error('[admin/exchange-rate-history]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/deposits', async (req, res) => {
  try {
    const status = req.query.status;
    const settings = await getCardPricingSettings();
    const deposits = status && status !== 'pending'
      ? await DepositRequest.listAll({ status: status === 'all' ? null : status, limit: 200 })
      : await DepositRequest.listPendingReview();
    res.json({ deposits: deposits.map((d) => enrichDeposit(d, settings)) });
  } catch (err) {
    console.error('[admin/deposits]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/deposits/:id/review', async (req, res) => {
  try {
    const depositId = parseInt(req.params.id, 10);
    if (!Number.isFinite(depositId)) {
      return res.status(400).json({ error: 'Invalid deposit id' });
    }
    const { action, admin_note, rejection_reason } = req.body;

    const deposit = await DepositRequest.findById(depositId);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found' });

    if (action === 'approve') {
      let result;
      if (isP2pDeposit(deposit)) {
        result = await approveP2pUsdtDeposit(deposit, {
          adminNote: admin_note || 'P2P deposit approved by admin',
          reviewedBy: 'admin',
          verifyOnChain: process.env.NODE_ENV === 'production',
        });
      } else {
        result = await creditDepositAndVerify(deposit, {
          txnId: deposit.kpay_transaction_id || deposit.txn_id,
          adminNote: admin_note || 'Approved by admin',
          createdBy: 'admin',
        });
      }

      await TransactionLog.create({
        userId: deposit.user_id,
        type: 'deposit_review',
        direction: 'neutral',
        referenceType: 'deposit_requests_v2',
        referenceId: deposit.id,
        description: `Admin approved deposit ${deposit.ref_code}`,
        createdBy: 'admin',
        metadata: { admin_note },
      });

      let activatedCard = result.card || null;
      const depositMeta = parseRecordMetadata(deposit.metadata);
      const cardRequestId = depositMeta.card_request_id
        || depositMeta.pricing?.card_request_id;

      if (!activatedCard && deposit.purpose === 'card_issuance' && cardRequestId) {
        try {
          const approval = await approvePendingCardRequest(parseInt(cardRequestId, 10), {
            adminNotes: admin_note || 'Auto-activated after deposit approval',
            skipDepositVerify: true,
            createdBy: 'admin',
          });
          activatedCard = approval.card;
          console.log('[admin/deposits/review] Auto-activated card', cardRequestId, 'status=', approval.card?.status);
        } catch (activateErr) {
          console.error('[admin/deposits/review] Card auto-activation failed:', activateErr.message);
        }
      }

      const creditedUser = result.user || null;
      return res.json({
        success: true,
        message: activatedCard
          ? 'Deposit approved and card activated'
          : (result.card_issuance
            ? 'Deposit verified — activate the pending card to complete issuance'
            : (result.alreadyVerified
              ? 'Deposit was already approved'
              : 'Deposit approved and balance credited')),
        deposit: result.deposit,
        user: creditedUser ? {
          id: creditedUser.id,
          balance_mmk: creditedUser.balance_mmk,
          balance_usdt: creditedUser.balance_usdt,
          balance: creditedUser.balance,
        } : null,
        card: activatedCard,
      });
    }

    if (action === 'reject') {
      const updated = await DepositRequest.review(depositId, {
        status: 'REJECTED',
        adminNote: admin_note,
        rejectionReason: rejection_reason || 'Rejected by admin',
      });

      if (deposit.purpose === 'card_reload') {
        const linkedReload = await CardReloadRequest.findPendingByDepositId(deposit.id);
        if (linkedReload) {
          await CardReloadRequest.updateStatus(linkedReload.id, 'rejected', {
            adminNote: rejection_reason || admin_note || 'Rejected via deposit review',
            rejectionReason: rejection_reason || 'Rejected by admin',
            reviewedBy: 'admin',
          });
        }
      }

      await TransactionLog.create({
        userId: deposit.user_id,
        type: 'deposit_rejected',
        direction: 'neutral',
        amountMmk: deposit.amount_mmk,
        amountUsd: deposit.amount_usd,
        referenceType: 'deposit_requests_v2',
        referenceId: deposit.id,
        description: `Deposit rejected: ${deposit.ref_code} — ${rejection_reason || 'No reason'}`,
        createdBy: 'admin',
      });

      return res.json({ success: true, message: 'Deposit rejected', deposit: updated });
    }

    if (action === 'review') {
      const updated = await DepositRequest.review(depositId, {
        status: 'UNDER_REVIEW',
        adminNote: admin_note,
      });
      return res.json({ success: true, deposit: updated });
    }

    res.status(400).json({ error: 'action must be approve, reject, or review' });
  } catch (err) {
    console.error('[admin/deposits/review]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cards/pending', async (_req, res) => {
  try {
    const settings = await getCardPricingSettings();
    const cards = await Card.listPendingRequests();

    const enriched = await Promise.all(cards.map(async (c) => {
      const meta = parseRecordMetadata(c.metadata);
      let linkedDeposit = null;

      if (meta.deposit_id) {
        linkedDeposit = await DepositRequest.findById(meta.deposit_id);
      } else if (meta.deposit_ref) {
        linkedDeposit = await DepositRequest.findByRefCode(meta.deposit_ref);
      }

      const deposit = linkedDeposit ? enrichDeposit(linkedDeposit, settings) : null;
      const pricing = meta.pricing || deposit?.pricing_breakdown || null;

      const rate = pricing?.mmk_to_usd_rate || settings.mmk_to_usd_rate;
      const pricingSummary = pricing
        ? `Card Fee: $${Number(pricing.issuance_fee_usd).toFixed(2)} + Deposit: $${Number(pricing.initial_load_usd).toFixed(2)} = Total: $${Number(pricing.total_usd_required).toFixed(2)} (${Number(pricing.total_mmk).toLocaleString()} MMK @ ${Number(rate).toLocaleString()} rate)`
        : (deposit
          ? `Wallet/legacy: $${Number(deposit.amount_usd).toFixed(2)} (${Number(deposit.amount_mmk).toLocaleString()} MMK)`
          : null);

      return {
        ...c,
        issuance_status: 'PENDING_ISSUANCE',
        display_status: 'PENDING_ISSUANCE',
        pricing,
        deposit,
        deposit_id: deposit?.id || meta.deposit_id || null,
        deposit_ref: deposit?.ref_code || meta.deposit_ref || null,
        deposit_status: deposit?.status || null,
        payment_method: meta.payment_method || deposit?.payment_method || null,
        pricing_summary: pricingSummary,
      };
    }));

    res.json({ cards: enriched });
  } catch (err) {
    console.error('[admin/cards/pending]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cards/issued', async (_req, res) => {
  try {
    const cards = await listIssuedCardsForAdmin();
    res.json({ cards });
  } catch (err) {
    console.error('[admin/cards/issued]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cards/:id/status', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id, 10);
    if (!cardId) return res.status(400).json({ error: 'Invalid card id' });

    const status = req.body?.status;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const result = await updateCardLifecycleStatus(cardId, {
      status,
      statusReason: req.body?.status_reason || req.body?.reason || null,
      adminNotes: req.body?.admin_notes || req.body?.admin_note || null,
      reviewedBy: 'admin',
    });

    const user = await User.findById(result.card.user_id);
    res.json({
      success: true,
      message: result.unchanged
        ? 'Card status unchanged'
        : `Card status updated to ${result.new_status}`,
      card: mapCardForAdmin(result.card, user),
      previous_status: result.previous_status,
      new_status: result.new_status,
    });
  } catch (err) {
    console.error('[admin/cards/status]', err);
    const isClient = err.message.includes('must be one of')
      || err.message.includes('not found')
      || err.message.includes('pending card');
    res.status(isClient ? 400 : 500).json({ error: err.message || 'Status update failed' });
  }
});

router.get('/reloads/pending', async (_req, res) => {
  try {
    const reloads = await listPendingReloadRequests();
    res.json({ reloads });
  } catch (err) {
    console.error('[admin/reloads/pending]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reloads/:id/approve', async (req, res) => {
  try {
    const reloadId = parseInt(req.params.id, 10);
    if (!reloadId) return res.status(400).json({ error: 'Invalid reload id' });

    const result = await approvePendingReload(reloadId, {
      adminNote: req.body?.admin_note || req.body?.admin_notes || 'Card reload approved by admin',
      reviewedBy: 'admin',
    });

    res.json({
      success: true,
      message: result.message || 'Card reload completed — balance credited and fee profit logged',
      reload: result.reload,
      card: result.card,
    });
  } catch (err) {
    console.error('[admin/reloads/approve]', err);
    const status = err.message.includes('not pending') || err.message.includes('not found') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Reload approval failed' });
  }
});

router.post('/reloads/:id/reject', async (req, res) => {
  try {
    const reloadId = parseInt(req.params.id, 10);
    if (!reloadId) return res.status(400).json({ error: 'Invalid reload id' });

    const result = await rejectPendingReload(reloadId, {
      adminNote: req.body?.admin_note,
      rejectionReason: req.body?.rejection_reason || req.body?.admin_note || 'Card reload rejected by admin',
      reviewedBy: 'admin',
    });

    res.json({
      success: true,
      message: result.message,
      reload: result.reload,
      user: result.user,
    });
  } catch (err) {
    console.error('[admin/reloads/reject]', err);
    const status = err.message.includes('not pending') || err.message.includes('not found') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Reload rejection failed' });
  }
});

router.get('/users/:userId/cards', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cards = await Card.findByUserId(userId);
    const mapped = cards
      .filter((c) => c.status !== 'cancelled')
      .map((c) => mapCardForAdmin(c, user));

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        wallet_balance: user.balance,
        wallet_balance_mmk: user.balance_mmk ?? 0,
        wallet_balance_usdt: user.balance_usdt ?? 0,
      },
      cards: mapped,
    });
  } catch (err) {
    console.error('[admin/users/cards]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cards/:id/transaction', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id, 10);
    const { action, amount_usd, merchant, note } = req.body;

    const result = await applyCardTransaction(cardId, {
      action,
      amount_usd,
      merchant,
      note,
      createdBy: 'admin',
    });

    res.json({
      success: true,
      message: result.action === 'topup'
        ? `Card topped up $${result.amount.toFixed(2)}`
        : `Card charged $${result.amount.toFixed(2)}`,
      ...result,
    });
  } catch (err) {
    console.error('[admin/cards/transaction]', err);
    const status = err.message.includes('Insufficient') || err.message.includes('required') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  }
});

router.post('/cards/:id/approve', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id, 10);
    if (!cardId) return res.status(400).json({ error: 'Invalid card id' });

    const {
      admin_notes,
      card_number,
      exp_date,
      cvv,
      balance_usd,
      card_holder_name,
    } = req.body || {};

    console.log('[admin/cards/approve] Request for card', cardId);

    const result = await approvePendingCardRequest(cardId, {
      adminNotes: admin_notes || req.body?.admin_note || 'Approved by admin',
      cardNumber: card_number,
      expDate: exp_date,
      cvv,
      balanceUsd: balance_usd != null ? parseFloat(balance_usd) : undefined,
      cardHolderName: card_holder_name,
      createdBy: 'admin',
    });

    const verified = await Card.findById(cardId);
    if (verified?.status !== 'active') {
      console.error('[admin/cards/approve] Post-check failed — card still', verified?.status);
      return res.status(500).json({
        error: 'Card approval did not persist active status',
        card: verified,
      });
    }

    res.json({
      success: true,
      message: 'Card issued and activated — user notified on dashboard',
      card: result.card,
      deposit: result.deposit,
      user: result.user,
    });
  } catch (err) {
    console.error('[admin/cards/approve]', err);
    const status = err.message.includes('not pending') || err.message.includes('not found') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Card approval failed' });
  }
});

router.post('/cards/issue', async (req, res) => {
  try {
    const userId = parseInt(req.body.user_id, 10);
    const {
      card_number, exp_date, cvv, card_holder_name,
      card_id, balance_usd, daily_limit_usd, admin_notes,
    } = req.body;

    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    if (!card_number || !exp_date || !cvv) {
      return res.status(400).json({ error: 'card_number, exp_date, cvv required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let resolvedBalance = balance_usd;
    if (card_id && (resolvedBalance === undefined || resolvedBalance === null)) {
      const pendingCard = await Card.findById(parseInt(card_id, 10));
      const meta = parseRecordMetadata(pendingCard?.metadata);
      if (meta.pricing?.initial_load_usd != null) {
        resolvedBalance = meta.pricing.initial_load_usd;
      }
    }

    let card;
    let isUpdate = false;
    if (card_id) {
      const pendingCard = await Card.findById(parseInt(card_id, 10));
      if (!pendingCard) return res.status(404).json({ error: 'Card not found' });
      if (pendingCard.user_id !== userId) {
        return res.status(400).json({ error: 'user_id does not match card owner' });
      }

      if (pendingCard.status === 'pending') {
        card = await Card.activatePendingCard(parseInt(card_id, 10), {
          cardNumber: card_number,
          expDate: exp_date,
          cvv,
          cardHolderName: card_holder_name || user.name,
          adminNotes: admin_notes,
          balanceUsd: resolvedBalance,
        });
      } else {
        isUpdate = true;
        card = await Card.updateCardDetails(parseInt(card_id, 10), {
          cardNumber: card_number,
          expDate: exp_date,
          cvv,
          cardHolderName: card_holder_name || user.name,
          adminNotes: admin_notes,
          dailyLimitUsd: daily_limit_usd,
        });
      }
      await Card.setPrimary(card.id, userId).catch(() => {});
    } else {
      card = await Card.issue({
        userId,
        cardNumber: card_number,
        expDate: exp_date,
        cvv,
        cardHolderName: card_holder_name || user.name,
        status: 'active',
        isPrimary: true,
        adminNotes: admin_notes,
        dailyLimitUsd: daily_limit_usd,
        metadata: resolvedBalance != null ? { balance_usd: parseFloat(resolvedBalance) } : null,
      });
    }

    const db = getDb();
    await db.run(`
      INSERT OR REPLACE INTO cards (user_id, card_number, exp_date, cvv, card_holder_name)
      SELECT ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM cards WHERE user_id = ?)
    `, userId, card_number, exp_date, cvv, card_holder_name || user.name, userId).catch(() => {});
    await db.run(`
      UPDATE cards SET card_number = ?, exp_date = ?, cvv = ?, card_holder_name = ? WHERE user_id = ?
    `, card_number, exp_date, cvv, card_holder_name || user.name, userId).catch(() => {});

    await TransactionLog.create({
      userId,
      type: isUpdate ? 'card_updated' : 'card_issued',
      direction: 'neutral',
      referenceType: 'cards_v2',
      referenceId: card.id,
      description: isUpdate
        ? `Admin updated card ending ${String(card_number).replace(/\s/g, '').slice(-4)}`
        : `Admin issued card ending ${String(card_number).slice(-4)}`,
      createdBy: 'admin',
      metadata: { balance_usd, daily_limit_usd, updated: isUpdate },
    });

    res.json({
      success: true,
      message: isUpdate ? 'Card details updated successfully.' : 'Card issued successfully.',
      card,
    });
  } catch (err) {
    console.error('[admin/cards/issue]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cards/:id/balance', async (req, res) => {
  try {
    const cardId = parseInt(req.params.id, 10);
    const { balance_usd, note } = req.body;

    if (balance_usd === undefined || balance_usd === null) {
      return res.status(400).json({ error: 'balance_usd is required' });
    }

    const existing = await Card.findById(cardId);
    if (!existing) return res.status(404).json({ error: 'Card not found' });

    const prevBalance = getCardBalance(existing);
    const newBalance = parseFloat(balance_usd);

    const card = await Card.updateCardDetails(cardId, {
      balanceUsd: newBalance,
      adminNotes: note,
    });

    const delta = newBalance - prevBalance;
    await TransactionLog.create({
      userId: existing.user_id,
      type: delta >= 0 ? 'card_topup' : 'card_transaction',
      direction: delta >= 0 ? 'credit' : 'debit',
      amountUsd: Math.abs(delta),
      balanceBefore: prevBalance,
      balanceAfter: newBalance,
      referenceType: 'cards_v2',
      referenceId: cardId,
      description: delta >= 0
        ? `Card Top-Up - $${Math.abs(delta).toFixed(2)} (manual set)`
        : `Card Transaction / Adjustment - $${Math.abs(delta).toFixed(2)} (manual set)`,
      createdBy: 'admin',
      metadata: { previous: prevBalance, new: newBalance, note },
    });

    res.json({ success: true, card: mapCardForAdmin(card, null) });
  } catch (err) {
    console.error('[admin/cards/balance]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/balance/adjust', async (req, res) => {
  try {
    const userId = parseInt(req.body.user_id, 10);
    const walletType = (req.body.wallet_type || req.body.currency || 'mmk').toLowerCase();
    const reason = req.body.reason || req.body.note || 'Admin balance adjustment';

    if (!userId) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (walletType === 'usdt' || req.body.amount_usdt != null) {
      const amountUsdt = parseFloat(req.body.amount_usdt ?? req.body.amount);
      if (Number.isNaN(amountUsdt)) {
        return res.status(400).json({ error: 'amount_usdt (or amount) required for USDT wallet adjustment' });
      }

      const balanceBefore = Number(user.balance_usdt ?? 0);
      const updatedUser = await adjustUsdt(userId, amountUsdt, reason, 'admin');
      const balanceAfter = Number(updatedUser.balance_usdt ?? 0);

      await TransactionLog.create({
        userId,
        type: 'admin_adjustment',
        direction: amountUsdt >= 0 ? 'credit' : 'debit',
        amountUsd: Math.abs(amountUsdt),
        balanceBefore,
        balanceAfter,
        description: reason,
        createdBy: 'admin',
        metadata: { wallet: 'usdt', adjustment: amountUsdt },
      });

      return res.json({
        success: true,
        wallet_type: 'usdt',
        user: {
          id: updatedUser.id,
          balance_usdt: balanceAfter,
          usdt_formatted: formatUsdt(balanceAfter),
        },
        adjustment: amountUsdt,
      });
    }

    if (walletType === 'mmk' || req.body.amount_mmk != null) {
      const amountMmk = parseFloat(req.body.amount_mmk ?? req.body.amount);
      if (Number.isNaN(amountMmk)) {
        return res.status(400).json({ error: 'amount_mmk (or amount) required for MMK wallet adjustment' });
      }

      const balanceBefore = Number(user.balance_mmk ?? 0);
      const updatedUser = await adjustMmk(userId, amountMmk, reason, 'admin');
      const balanceAfter = Number(updatedUser.balance_mmk ?? 0);

      await TransactionLog.create({
        userId,
        type: 'admin_adjustment',
        direction: amountMmk >= 0 ? 'credit' : 'debit',
        amountMmk: Math.abs(amountMmk),
        balanceBefore,
        balanceAfter,
        description: reason,
        createdBy: 'admin',
        metadata: { wallet: 'mmk', adjustment: amountMmk },
      });

      return res.json({
        success: true,
        wallet_type: 'mmk',
        user: {
          id: updatedUser.id,
          balance_mmk: balanceAfter,
          mmk_formatted: formatMmk(balanceAfter),
        },
        adjustment: amountMmk,
      });
    }

    const amountUsd = parseFloat(req.body.amount_usd);
    if (Number.isNaN(amountUsd)) {
      return res.status(400).json({ error: 'amount_usd or amount_mmk required' });
    }

    const balanceBefore = user.balance;
    const db = getDb();
    await db.run(`
      UPDATE users SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?
    `, amountUsd, userId);

    const updatedUser = await User.findById(userId);

    await TransactionLog.create({
      userId,
      type: 'admin_adjustment',
      direction: amountUsd >= 0 ? 'credit' : 'debit',
      amountUsd: Math.abs(amountUsd),
      balanceBefore,
      balanceAfter: updatedUser.balance,
      description: reason,
      createdBy: 'admin',
      metadata: { wallet: 'usd' },
    });

    res.json({
      success: true,
      wallet_type: 'usd',
      user: { id: updatedUser.id, balance: updatedUser.balance },
      adjustment: amountUsd,
    });
  } catch (err) {
    console.error('[admin/balance/adjust]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const db = getDb();
    const users = await db.all(`
      SELECT id, email, name, phone, balance, balance_mmk, balance_usdt, email_verified, auth_status, created_at
      FROM users ORDER BY created_at DESC LIMIT 200
    `);
    res.json({ users });
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    const category = (req.query.category || '').toLowerCase();

    if (category === 'p2p') {
      const transactions = await listP2pAdminTransactions({ userId });
      return res.json({ category: 'p2p', transactions });
    }
    if (category === 'card_reload') {
      const transactions = await listCardReloadAdminTransactions({ userId });
      return res.json({ category: 'card_reload', transactions });
    }

    const type = req.query.type || null;
    const transactions = await TransactionLog.listAll({ userId, type, limit: 200 });
    res.json({ category: 'all', transactions });
  } catch (err) {
    console.error('[admin/transactions]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/support/threads', async (req, res) => {
  try {
    const status = req.query.status || null;
    const threads = await SupportThread.listAll({ status });
    res.json({ threads });
  } catch (err) {
    console.error('[admin/support/threads]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/support/threads/:id/messages', async (req, res) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const thread = await SupportThread.findById(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const messages = await SupportMessage.findByThreadId(threadId);
    await SupportMessage.markReadByAdmin(threadId);

    res.json({ thread, messages });
  } catch (err) {
    console.error('[admin/support/messages]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/support/threads/:id/reply', async (req, res) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const thread = await SupportThread.findById(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const msg = await SupportMessage.create({
      threadId,
      senderType: 'admin',
      senderId: null,
      message: message.trim(),
    });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('[admin/support/reply]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/support/threads/:id/close', async (req, res) => {
  try {
    const thread = await SupportThread.close(parseInt(req.params.id, 10));
    res.json({ success: true, thread });
  } catch (err) {
    console.error('[admin/support/close]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/p2p-buy-orders', async (req, res) => {
  try {
    const status = req.query.status || 'pending_seller_release';
    const orders = await listP2pBuyOrdersForAdmin({ status: status === 'all' ? null : status });
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[admin/p2p-buy-orders GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/p2p-buy-orders/:id/release', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { admin_note } = req.body;
    const result = await releaseP2pBuyOrder(orderId, {
      adminNote: admin_note || 'MMK receipt confirmed — USDT released to wallet',
      reviewedBy: 'admin',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/p2p-buy-orders release]', err);
    res.status(400).json({ error: err.message || 'Failed to release order' });
  }
});

router.post('/p2p-buy-orders/:id/reject', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { admin_note, rejection_reason } = req.body;
    const result = await rejectP2pBuyOrder(orderId, {
      adminNote: admin_note,
      rejectionReason: rejection_reason,
      reviewedBy: 'admin',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/p2p-buy-orders reject]', err);
    res.status(400).json({ error: err.message || 'Failed to reject order' });
  }
});

router.get('/p2p-sell-orders', async (req, res) => {
  try {
    const status = req.query.status || 'pending_merchant_mmk';
    const orders = await listP2pSellOrdersForAdmin({ status: status === 'all' ? null : status });
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[admin/p2p-sell-orders GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/p2p-sell-orders/:id/reject', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { admin_note, rejection_reason } = req.body;
    const result = await rejectP2pSellOrder(orderId, {
      adminNote: admin_note,
      rejectionReason: rejection_reason,
      reviewedBy: 'admin',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/p2p-sell-orders reject]', err);
    res.status(400).json({ error: err.message || 'Failed to reject sell order' });
  }
});

router.get('/p2p-disputes', async (_req, res) => {
  try {
    const disputes = await listDisputedOrdersForAdmin();
    res.json({ success: true, disputes });
  } catch (err) {
    console.error('[admin/p2p-disputes GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/p2p-disputes/:orderType/:id/resolve', async (req, res) => {
  try {
    const { orderType, id } = req.params;
    const { resolution, admin_note } = req.body;
    if (!['force_release', 'refund'].includes(resolution)) {
      return res.status(400).json({ error: 'resolution must be force_release or refund' });
    }
    const result = await resolveDispute(orderType, parseInt(id, 10), {
      resolution,
      adminNote: admin_note,
      reviewedBy: 'admin',
    });
    res.json({
      success: true,
      message: result.message,
      order: result.order,
      user: result.user,
    });
  } catch (err) {
    console.error('[admin/p2p-disputes resolve]', err);
    res.status(400).json({ error: err.message || 'Failed to resolve dispute' });
  }
});

router.get('/p2p-orders/:orderType/:id/messages', async (req, res) => {
  try {
    const { orderType, id } = req.params;
    const messages = await listOrderMessagesForAdmin(orderType, parseInt(id, 10));
    res.json({ success: true, messages });
  } catch (err) {
    console.error('[admin/p2p-messages GET]', err);
    res.status(400).json({ error: err.message || 'Failed to load messages' });
  }
});

router.post('/p2p-orders/:orderType/:id/messages', uploadP2pAttachment.single('attachment'), async (req, res) => {
  try {
    const { orderType, id } = req.params;
    const attachmentPath = req.file ? publicP2pUploadPath(req.file.filename) : null;
    const message = await postAdminOrderMessage(orderType, parseInt(id, 10), {
      message: req.body.message,
      attachmentPath,
    });
    res.json({ success: true, message });
  } catch (err) {
    console.error('[admin/p2p-messages POST]', err);
    res.status(400).json({ error: err.message || 'Failed to send message' });
  }
});

router.get('/revenue/dashboard', async (_req, res) => {
  try {
    const dashboard = await getRevenueDashboard();
    res.json({ success: true, ...dashboard });
  } catch (err) {
    console.error('[admin/revenue/dashboard]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/kyc-requests', async (req, res) => {
  try {
    const status = req.query.status || 'PENDING_REVIEW';
    const submissions = await listKycSubmissionsForAdmin({
      status: status === 'all' ? null : status,
    });
    res.json({ success: true, submissions });
  } catch (err) {
    console.error('[admin/kyc-requests GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/kyc-requests/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await approveKyc(id, { adminNote: req.body.admin_note, reviewedBy: 'admin' });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/kyc-requests approve]', err);
    res.status(400).json({ error: err.message || 'Failed to approve KYC' });
  }
});

router.post('/kyc-requests/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await rejectKyc(id, {
      rejectionReason: req.body.rejection_reason || req.body.reason,
      reviewedBy: 'admin',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/kyc-requests reject]', err);
    res.status(400).json({ error: err.message || 'Failed to reject KYC' });
  }
});

// ─── Withdrawal review (USDT crypto/bank + MMK bank) ───
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const MmkWithdrawal = require('../models/MmkWithdrawal');
const {
  completeUsdtWithdrawal,
  rejectUsdtWithdrawal,
  completeMmkWithdrawal,
  rejectMmkWithdrawal,
} = require('../services/withdrawalService');
const { walletPayload: adminWalletPayload } = require('../services/walletService');

router.get('/withdrawals/usdt', async (req, res) => {
  try {
    const status = req.query.status;
    const rows = await UsdtWithdrawal.listAll({
      status: status && status !== 'all' ? status : undefined,
      limit: 200,
    });
    res.json({ withdrawals: rows });
  } catch (err) {
    console.error('[admin/withdrawals/usdt GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/withdrawals/usdt/:id/complete', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const withdrawal = await completeUsdtWithdrawal(id, {
      adminNote: req.body.admin_note,
      txHash: req.body.tx_hash,
      adminId: req.user?.id,
    });
    res.json({
      success: true,
      message: `USDT withdrawal ${withdrawal.ref_code} marked completed`,
      withdrawal,
    });
  } catch (err) {
    console.error('[admin/withdrawals/usdt complete]', err);
    res.status(400).json({ error: err.message || 'Failed to complete withdrawal' });
  }
});

router.post('/withdrawals/usdt/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const withdrawal = await rejectUsdtWithdrawal(id, {
      adminNote: req.body.admin_note || req.body.rejection_reason,
      adminId: req.user?.id,
    });
    const user = await User.findById(withdrawal.user_id);
    res.json({
      success: true,
      message: `USDT withdrawal ${withdrawal.ref_code} rejected — balance refunded`,
      withdrawal,
      wallet: user ? adminWalletPayload(user) : null,
    });
  } catch (err) {
    console.error('[admin/withdrawals/usdt reject]', err);
    res.status(400).json({ error: err.message || 'Failed to reject withdrawal' });
  }
});

router.get('/withdrawals/mmk', async (req, res) => {
  try {
    const status = req.query.status;
    const rows = await MmkWithdrawal.listAll({
      status: status && status !== 'all' ? status : undefined,
      limit: 200,
    });
    res.json({ withdrawals: rows });
  } catch (err) {
    console.error('[admin/withdrawals/mmk GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/withdrawals/mmk/:id/complete', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const withdrawal = await completeMmkWithdrawal(id, {
      adminNote: req.body.admin_note,
      adminId: req.user?.id,
    });
    res.json({
      success: true,
      message: `MMK withdrawal ${withdrawal.ref_code} marked completed`,
      withdrawal,
    });
  } catch (err) {
    console.error('[admin/withdrawals/mmk complete]', err);
    res.status(400).json({ error: err.message || 'Failed to complete withdrawal' });
  }
});

router.post('/withdrawals/mmk/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const withdrawal = await rejectMmkWithdrawal(id, {
      adminNote: req.body.admin_note || req.body.rejection_reason,
      adminId: req.user?.id,
    });
    const user = await User.findById(withdrawal.user_id);
    res.json({
      success: true,
      message: `MMK withdrawal ${withdrawal.ref_code} rejected — balance refunded`,
      withdrawal,
      wallet: user ? adminWalletPayload(user) : null,
    });
  } catch (err) {
    console.error('[admin/withdrawals/mmk reject]', err);
    res.status(400).json({ error: err.message || 'Failed to reject withdrawal' });
  }
});

module.exports = router;
