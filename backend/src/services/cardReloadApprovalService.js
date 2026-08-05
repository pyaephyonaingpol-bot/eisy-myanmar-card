const Card = require('../models/Card');
const { normalizeCardStatus, displayStatusLabel } = require('../constants/cardStatuses');
const CardReloadRequest = require('../models/CardReloadRequest');
const DepositRequest = require('../models/DepositRequest');
const TransactionLog = require('../models/TransactionLog');
const User = require('../models/User');
const { applyCardTransaction } = require('./cardBalanceService');
const { creditDepositAndVerify } = require('./depositService');
const { creditMmk, creditUsdt, formatMmk, formatUsdt } = require('./walletService');
const { recordPlatformUsdFee, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const { resolveReloadNetProfit } = require('../constants/cardReloadFees');
const { parseRecordMetadata } = require('./settingsService');

const RELOAD_PENDING_MESSAGE = 'Reload request submitted! Pending admin approval.';

async function listPendingReloadRequests() {
  const rows = await CardReloadRequest.listPending();
  return rows.map((row) => CardReloadRequest.mapForClient(row));
}

async function approvePendingReload(reloadId, {
  adminNote,
  reviewedBy = 'admin',
} = {}) {
  const request = await CardReloadRequest.findById(reloadId);
  if (!request) throw new Error('Reload request not found');
  if (request.status !== 'pending') {
    throw new Error(`Reload request is not pending (current status: ${request.status})`);
  }

  const card = await Card.findById(request.card_id);
  if (!card) throw new Error('Target card not found');
  if (normalizeCardStatus(card.status) !== 'active') {
    throw new Error(`Card is ${displayStatusLabel(card.status)} — only active cards can receive reload credits`);
  }

  let cardResult;
  if (request.deposit_id) {
    const deposit = await DepositRequest.findById(request.deposit_id);
    if (!deposit) throw new Error('Linked deposit not found');
    if (deposit.status === 'VERIFIED') {
      cardResult = { card: await Card.findById(request.card_id) };
    } else {
      const verified = await creditDepositAndVerify(deposit, {
        txnId: deposit.kpay_transaction_id || deposit.tx_hash,
        adminNote: adminNote || 'Card reload approved by admin',
        createdBy: reviewedBy,
      });
      cardResult = { card: verified.card || await Card.findById(request.card_id) };
    }
  } else {
    cardResult = await applyCardTransaction(request.card_id, {
      action: 'topup',
      amount_usd: Number(request.net_usd_to_card),
      note: adminNote || `Card reload approved by admin (${request.wallet_type.toUpperCase()} wallet)`,
      createdBy: reviewedBy,
    });
  }

  const updated = await CardReloadRequest.updateStatus(reloadId, 'approved', {
    adminNote: adminNote || 'Card reload approved by admin',
    reviewedBy,
  });

  await TransactionLog.create({
    userId: request.user_id,
    type: 'card_updated',
    direction: 'neutral',
    amountMmk: request.amount_mmk,
    amountUsd: request.net_usd_to_card,
    referenceType: 'card_reload_requests',
    referenceId: reloadId,
    description: `Card reload completed — $${Number(request.net_usd_to_card).toFixed(2)} USD added to your card`,
    createdBy: reviewedBy,
    metadata: {
      reload_request_id: reloadId,
      card_id: request.card_id,
      wallet_type: request.wallet_type,
      action: 'reload_completed',
      status: 'COMPLETED',
      fee_type: PLATFORM_FEE_TYPES.CARD_RELOAD,
      fee_profit_usd: resolveReloadNetProfit({
        pricing: parseRecordMetadata(request.pricing_json),
        reload_fee_usd: request.reload_fee_usd,
      }),
      notification: 'card_reload_completed',
    },
  });

  const pricingMeta = parseRecordMetadata(request.pricing_json);
  const netProfitUsd = resolveReloadNetProfit({
    pricing: pricingMeta,
    reload_fee_usd: request.reload_fee_usd,
  });

  if (Number.isFinite(netProfitUsd) && netProfitUsd > 0) {
    await recordPlatformUsdFee(netProfitUsd, {
      feeType: PLATFORM_FEE_TYPES.CARD_RELOAD,
      description: `Card reload net profit — RELOAD-${reloadId} ($${netProfitUsd.toFixed(2)})`,
      referenceType: 'card_reload_requests',
      referenceId: reloadId,
      relatedUserId: request.user_id,
      createdBy: reviewedBy,
      metadata: {
        reload_request_id: reloadId,
        card_id: request.card_id,
        wallet_type: request.wallet_type,
        net_usd_to_card: request.net_usd_to_card,
        user_fee_usd: request.reload_fee_usd,
        provider_cost_usd: pricingMeta?.provider_cost_usd ?? 1.5,
        net_profit_usd: netProfitUsd,
      },
    });
  }

  return {
    reload: CardReloadRequest.mapForClient(updated),
    card: cardResult.card,
    message: `Card reload approved — $${Number(request.net_usd_to_card).toFixed(2)} USD credited to card`,
  };
}

async function rejectPendingReload(reloadId, {
  adminNote,
  rejectionReason,
  reviewedBy = 'admin',
} = {}) {
  const request = await CardReloadRequest.findById(reloadId);
  if (!request) throw new Error('Reload request not found');
  if (request.status !== 'pending') {
    throw new Error(`Reload request is not pending (current status: ${request.status})`);
  }

  const reason = rejectionReason || adminNote || 'Card reload rejected by admin';

  if (request.deposit_id) {
    const deposit = await DepositRequest.findById(request.deposit_id);
    if (deposit && !['VERIFIED', 'REJECTED', 'FAILED'].includes(deposit.status)) {
      await DepositRequest.review(request.deposit_id, {
        status: 'REJECTED',
        adminNote: reason,
        rejectionReason: reason,
        reviewedByAdminId: null,
      });
    }
  } else if (request.wallet_type === 'usdt') {
    const amountUsdt = Number(request.amount_usdt);
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      throw new Error('Invalid USDT refund amount on reload request');
    }
    await creditUsdt(request.user_id, amountUsdt, {
      description: `Card reload refund — ${formatUsdt(amountUsdt)} returned to wallet`,
      referenceType: 'card_reload_requests',
      referenceId: reloadId,
      createdBy: reviewedBy,
      metadata: { reload_request_id: reloadId, refund: true },
    });
  } else {
    const amountMmk = Number(request.amount_mmk);
    if (!Number.isFinite(amountMmk) || amountMmk <= 0) {
      throw new Error('Invalid MMK refund amount on reload request');
    }
    await creditMmk(request.user_id, amountMmk, {
      description: `Card reload refund — ${formatMmk(amountMmk)} returned to wallet`,
      referenceType: 'card_reload_requests',
      referenceId: reloadId,
      createdBy: reviewedBy,
      metadata: { reload_request_id: reloadId, refund: true },
    });
  }

  const updated = await CardReloadRequest.updateStatus(reloadId, 'rejected', {
    adminNote: adminNote || reason,
    rejectionReason: reason,
    reviewedBy,
  });

  await TransactionLog.create({
    userId: request.user_id,
    type: request.deposit_id ? 'deposit_rejected' : 'balance_credit',
    direction: request.deposit_id ? 'neutral' : 'credit',
    amountMmk: request.amount_mmk,
    amountUsd: request.amount_usdt ?? request.net_usd_to_card,
    referenceType: 'card_reload_requests',
    referenceId: reloadId,
    description: request.deposit_id
      ? `Card reload rejected (${reason})`
      : `Card reload rejected — wallet refunded (${reason})`,
    createdBy: reviewedBy,
    metadata: {
      reload_request_id: reloadId,
      card_id: request.card_id,
      wallet_type: request.wallet_type,
      action: 'reload_rejected',
      rejection_reason: reason,
    },
  });

  const user = await User.findById(request.user_id);

  return {
    reload: CardReloadRequest.mapForClient(updated),
    user,
    message: request.deposit_id
      ? 'Card reload rejected'
      : 'Card reload rejected — wallet balance refunded',
  };
}

module.exports = {
  RELOAD_PENDING_MESSAGE,
  listPendingReloadRequests,
  approvePendingReload,
  rejectPendingReload,
};
