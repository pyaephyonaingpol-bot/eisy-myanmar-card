const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const { getDb } = require('../db');
const {
  getCardPricingSettings,
  calculateCardRequestPricing,
  calculateCardReloadPricing,
  calculateCardRequestPricingUsdt,
  calculateCardReloadPricingUsdt,
  buildRateSnapshot,
  parseRecordMetadata,
} = require('./settingsService');
const { debitMmk, debitUsdt, formatMmk, formatUsdt } = require('./walletService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { RELOAD_PENDING_MESSAGE } = require('./cardReloadApprovalService');

const CARD_REQUEST_PENDING_MESSAGE =
  'Card request submitted. An admin will process your card shortly (usually within 15-30 mins).';

async function purchaseCardFromWallet(userId, {
  initialLoadUsd,
  cardHolderName,
  note,
}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const pending = await Card.findByUserId(userId, { status: 'pending' });
  if (pending.length) {
    throw new Error('You already have a pending card request');
  }

  const settings = await getCardPricingSettings();
  const pricing = calculateCardRequestPricing(initialLoadUsd, settings);
  const requiredMmk = pricing.total_mmk;

  await debitMmk(userId, requiredMmk, {
    description: `New card purchase — ${formatMmk(requiredMmk)} (${pricing.total_usd_required} USD incl. fee)`,
    createdBy: 'user',
    metadata: { purpose: 'card_issuance', pricing },
  });

  const rateSnapshot = await buildRateSnapshot();
  const cardMetadata = {
    pricing,
    payment_method: 'wallet',
    paid_from_wallet: true,
    wallet_debit_mmk: requiredMmk,
    requested_at: new Date().toISOString(),
    rate_snapshot: rateSnapshot,
  };

  const card = await Card.requestPending({
    userId,
    cardHolderName: cardHolderName || user.name,
    userNote: note || 'Paid from MMK wallet',
    metadata: cardMetadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountMmk: requiredMmk,
    amountUsd: pricing.total_usd_required,
    referenceType: 'cards_v2',
    referenceId: card.id,
    description: `Card application submitted — ${formatMmk(requiredMmk)} deducted from MMK wallet (pending admin issuance)`,
    createdBy: 'user',
    metadata: {
      purpose: 'card_issuance',
      pricing,
      paid_from_wallet: true,
      pending: true,
      card_request_id: card.id,
    },
  });

  const updatedUser = await User.findById(userId);

  return {
    card,
    pricing,
    wallet_debit_mmk: requiredMmk,
    balance_mmk: Number(updatedUser.balance_mmk ?? 0),
    pending: true,
    message: CARD_REQUEST_PENDING_MESSAGE,
  };
}

async function reloadCardFromWallet(userId, { cardId, amountMmk }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const card = await Card.findById(cardId);
  if (!card || card.user_id !== userId) throw new Error('Card not found');
  if (card.status !== 'active') throw new Error('Only active cards can be reloaded');

  const settings = await getCardPricingSettings();
  const pricing = calculateCardReloadPricing(amountMmk, settings);
  const requiredMmk = pricing.deposit_mmk;

  await debitMmk(userId, requiredMmk, {
    description: `Card reload hold — ${formatMmk(requiredMmk)} (pending admin approval)`,
    referenceType: 'cards_v2',
    referenceId: cardId,
    createdBy: 'user',
    metadata: { purpose: 'card_reload', pricing, card_id: cardId, pending: true },
  });

  const reloadRequest = await CardReloadRequest.create({
    userId,
    cardId,
    walletType: 'mmk',
    amountMmk: requiredMmk,
    netUsdToCard: pricing.net_usd_to_card,
    reloadFeeUsd: pricing.reload_fee_usd,
    grossUsd: pricing.gross_usd,
    pricing,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountMmk: requiredMmk,
    amountUsd: pricing.net_usd_to_card,
    referenceType: 'card_reload_requests',
    referenceId: reloadRequest.id,
    description: `Card reload requested from MMK wallet — ${formatMmk(requiredMmk)} (pending admin review)`,
    createdBy: 'user',
    metadata: { pricing, paid_from_wallet: true, wallet_type: 'mmk', pending: true },
  });

  const updatedUser = await User.findById(userId);

  return {
    pending: true,
    reload_request: CardReloadRequest.mapForClient(reloadRequest),
    reload_request_id: reloadRequest.id,
    pricing,
    wallet_debit_mmk: requiredMmk,
    balance_mmk: Number(updatedUser.balance_mmk ?? 0),
    message: RELOAD_PENDING_MESSAGE,
  };
}

async function purchaseCardFromUsdtWallet(userId, {
  initialLoadUsd,
  cardHolderName,
  note,
}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const pending = await Card.findByUserId(userId, { status: 'pending' });
  if (pending.length) {
    throw new Error('You already have a pending card request');
  }

  const settings = await getCardPricingSettings();
  const pricing = calculateCardRequestPricingUsdt(initialLoadUsd, settings);
  const requiredUsdt = pricing.total_usdt;

  await debitUsdt(userId, requiredUsdt, {
    description: `New card purchase — ${formatUsdt(requiredUsdt)} (${pricing.total_usd_required} USD incl. fee)`,
    createdBy: 'user',
    metadata: { purpose: 'card_issuance', pricing, wallet: 'usdt' },
  });

  const cardMetadata = {
    pricing,
    payment_method: 'usdt_wallet',
    paid_from_wallet: true,
    wallet_type: 'usdt',
    wallet_debit_usdt: requiredUsdt,
    requested_at: new Date().toISOString(),
  };

  const card = await Card.requestPending({
    userId,
    cardHolderName: cardHolderName || user.name,
    userNote: note || 'Paid from USDT wallet',
    metadata: cardMetadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: pricing.total_usd_required,
    referenceType: 'cards_v2',
    referenceId: card.id,
    description: `Card application submitted — ${formatUsdt(requiredUsdt)} deducted from USDT wallet (pending admin issuance)`,
    createdBy: 'user',
    metadata: {
      purpose: 'card_issuance',
      pricing,
      paid_from_wallet: true,
      wallet: 'usdt',
      pending: true,
      card_request_id: card.id,
    },
  });

  const updatedUser = await User.findById(userId);

  return {
    card,
    pricing,
    wallet_debit_usdt: requiredUsdt,
    balance_usdt: Number(updatedUser.balance_usdt ?? 0),
    pending: true,
    message: CARD_REQUEST_PENDING_MESSAGE,
  };
}

async function reloadCardFromUsdtWallet(userId, { cardId, amountUsdt }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const card = await Card.findById(cardId);
  if (!card || card.user_id !== userId) throw new Error('Card not found');
  if (card.status !== 'active') throw new Error('Only active cards can be reloaded');

  const settings = await getCardPricingSettings();
  const pricing = calculateCardReloadPricingUsdt(amountUsdt, settings);
  const requiredUsdt = pricing.deposit_usdt;

  await debitUsdt(userId, requiredUsdt, {
    description: `Card reload hold — ${formatUsdt(requiredUsdt)} (pending admin approval)`,
    referenceType: 'cards_v2',
    referenceId: cardId,
    createdBy: 'user',
    metadata: { purpose: 'card_reload', pricing, card_id: cardId, wallet: 'usdt', pending: true },
  });

  const reloadRequest = await CardReloadRequest.create({
    userId,
    cardId,
    walletType: 'usdt',
    amountUsdt: requiredUsdt,
    netUsdToCard: pricing.net_usd_to_card,
    reloadFeeUsd: pricing.reload_fee_usd,
    grossUsd: pricing.gross_usd,
    pricing,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: pricing.net_usd_to_card,
    referenceType: 'card_reload_requests',
    referenceId: reloadRequest.id,
    description: `Card reload requested from USDT wallet — ${formatUsdt(requiredUsdt)} (pending admin review)`,
    createdBy: 'user',
    metadata: { pricing, paid_from_wallet: true, wallet: 'usdt', pending: true },
  });

  const updatedUser = await User.findById(userId);

  return {
    pending: true,
    reload_request: CardReloadRequest.mapForClient(reloadRequest),
    reload_request_id: reloadRequest.id,
    pricing,
    wallet_debit_usdt: requiredUsdt,
    balance_usdt: Number(updatedUser.balance_usdt ?? 0),
    message: RELOAD_PENDING_MESSAGE,
  };
}

module.exports = {
  purchaseCardFromWallet,
  reloadCardFromWallet,
  purchaseCardFromUsdtWallet,
  reloadCardFromUsdtWallet,
};
