/**
 * Standard Card (Bitnob / KYC) wallet flows.
 *
 * Debits users.balance_bitnob_usdt only — never Master Wallet (balance_usdt).
 * Instant Card (Kripicard) lives in kripicardCardWalletService.js.
 */

const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const {
  getCardPricingSettings,
  calculateCardRequestPricingUsdt,
  calculateCardReloadPricingUsdt,
  parseRecordMetadata,
} = require('./settingsService');
const { formatUsdt } = require('./walletService');
const {
  debitBitnobUsdt,
  creditBitnobUsdt,
  formatBitnobUsdt,
} = require('./bitnobWalletLedgerService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { RELOAD_PENDING_MESSAGE } = require('./cardReloadApprovalService');
const { recordPlatformUsdFee, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const {
  issueCardForUser,
  resolveBitnobCustomerId,
  assertBitnobConfigured,
} = require('./cardIssueService');

const CARD_REQUEST_PENDING_MESSAGE =
  'Card request submitted. Provider is provisioning your virtual card details.';

const CARD_ISSUED_MESSAGE =
  'Card issued successfully. Your virtual card is ready to use.';

/**
 * Purchase + auto-issue a Standard (Bitnob) virtual card from the Bitnob ledger.
 * Master Wallet USDT cannot pay for this path.
 */
async function purchaseCardFromUsdtWallet(userId, {
  initialLoadUsd,
  cardHolderName,
  note,
  customerId,
  paymentRef,
}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const pending = await Card.findByUserId(userId, { status: 'pending' });
  if (pending.length) {
    throw new Error('You already have a pending card request');
  }

  const nameOnCard = String(cardHolderName || user.name || '').trim();
  if (nameOnCard.length < 2) {
    const err = new Error('Cardholder name must be at least 2 characters');
    err.code = 'INVALID_NAME_ON_CARD';
    throw err;
  }

  const resolvedCustomerId = resolveBitnobCustomerId({ customerId, user });
  if (!resolvedCustomerId) {
    const err = new Error(
      'Standard Card profile is not ready. Complete Card KYC first, or set BITNOB_DEFAULT_CUSTOMER_ID.'
    );
    err.code = 'BITNOB_CUSTOMER_REQUIRED';
    throw err;
  }

  const settings = await getCardPricingSettings();
  const pricing = calculateCardRequestPricingUsdt(initialLoadUsd, settings);
  const providerLoadUsd = pricing.provider_load_usd;
  const platformMarkupUsd = pricing.platform_markup_usd;
  const requiredUsdt = pricing.total_charge_usdt;
  const idempotencyKey = paymentRef
    || `bitnob-issue-${userId}-${providerLoadUsd}-${Date.now()}`;

  assertBitnobConfigured();

  const debitDescription = `Standard Card purchase — ${formatBitnobUsdt(requiredUsdt)} `
    + `($${providerLoadUsd.toFixed(2)} load + fees)`;
  const debitMetadata = {
    purpose: 'card_issuance',
    pricing,
    wallet: 'bitnob_usdt',
    payment_wallet: 'bitnob_usdt',
    ledger: 'bitnob',
    mmk_wallet_allowed: false,
    auto_issue: true,
    provider: 'bitnob',
    card_flow: 'standard',
    provider_load_usd: providerLoadUsd,
    bitnob_create_fee_usd: pricing.bitnob_create_fee_usd,
    bitnob_funding_fee_usd: pricing.bitnob_funding_fee_usd,
    platform_markup_usd: platformMarkupUsd,
  };

  let journalId = idempotencyKey;
  let bitnobDebited = false;

  try {
    await debitBitnobUsdt(userId, requiredUsdt, {
      description: debitDescription,
      createdBy: 'user',
      journalId,
      purpose: 'standard_card_issuance',
      referenceType: 'cards_v2',
      metadata: debitMetadata,
    });
    bitnobDebited = true;
  } catch (debitErr) {
    throw debitErr;
  }

  let issued;
  try {
    issued = await issueCardForUser({
      userId,
      nameOnCard,
      customerId: resolvedCustomerId,
      amount: providerLoadUsd,
      currency: 'USD',
      paymentRef: idempotencyKey,
      idempotencyKey,
      user,
      metadata: {
        source: 'purchaseCardFromBitnobWallet',
        wallet_type: 'bitnob_usdt',
        ledger: 'bitnob',
        pricing,
        provider_load_usd: providerLoadUsd,
        platform_markup_usd: platformMarkupUsd,
        total_charge_usdt: requiredUsdt,
        note: note || null,
      },
    });
  } catch (issueErr) {
    if (bitnobDebited) {
      try {
        await creditBitnobUsdt(userId, requiredUsdt, {
          description: `Standard Card issuance refund — ${formatBitnobUsdt(requiredUsdt)}`,
          createdBy: 'system',
          journalId: `${journalId}-refund`,
          purpose: 'standard_card_issuance_refund',
          metadata: {
            purpose: 'card_issuance_refund',
            reason: issueErr.message,
            code: issueErr.code || null,
            ledger: 'bitnob',
          },
        });
      } catch (refundErr) {
        console.error('[cardWallet] Bitnob ledger refund failed after issue error:', refundErr);
        issueErr.refund_failed = true;
        issueErr.refund_error = refundErr.message;
      }
    }
    throw issueErr;
  }

  const providerCard = issued.provider_card || {};
  const userCard = issued.user_card || {};
  const cardNumber = providerCard.card_number || userCard.card_number || null;
  const expDate = providerCard.exp_date || userCard.exp_date || null;
  const cvv = providerCard.cvv || userCard.cvv || null;
  const balanceUsd = Number(
    providerCard.balance ?? userCard.balance ?? pricing.initial_load_usd
  );
  const hasFullPan = Boolean(cardNumber && !String(cardNumber).includes('*') && cvv && expDate);

  const cardMetadata = {
    pricing,
    provider_load_usd: providerLoadUsd,
    platform_markup_usd: platformMarkupUsd,
    total_charge_usdt: requiredUsdt,
    payment_method: 'bitnob_wallet',
    paid_from_wallet: true,
    wallet_type: 'bitnob_usdt',
    ledger: 'bitnob',
    card_flow: 'standard',
    wallet_debit_usdt: requiredUsdt,
    requested_at: new Date().toISOString(),
    activated_at: hasFullPan ? new Date().toISOString() : null,
    request_status: hasFullPan ? 'approved' : 'pending_provider_details',
    balance_usd: balanceUsd,
    provider: 'bitnob',
    provider_card_id: providerCard.card_id || userCard.card_id,
    bitnob_customer_id: resolvedCustomerId,
    supabase_user_card_id: userCard.id || null,
    auto_issued: true,
    issuance_mode: 'realtime_bitnob',
    masked_pan: providerCard.masked_pan || null,
  };

  let card;
  if (hasFullPan) {
    card = await Card.issue({
      userId,
      cardNumber,
      expDate,
      cvv,
      cardHolderName: nameOnCard,
      cardType: 'virtual',
      currency: 'USD',
      status: 'active',
      isPrimary: true,
      adminNotes: note || 'Auto-issued via Bitnob (Standard Card wallet)',
      metadata: cardMetadata,
    });
  } else {
    card = await Card.requestPending({
      userId,
      cardHolderName: nameOnCard,
      userNote: note || 'Awaiting card details from provider',
      metadata: {
        ...cardMetadata,
        request_status: 'pending_provider_details',
      },
    });
  }

  try {
    await recordPlatformUsdFee(platformMarkupUsd, {
      feeType: PLATFORM_FEE_TYPES.CARD_ISSUE,
      userId,
      referenceType: 'cards_v2',
      referenceId: card.id,
      description: `Card issuance markup $${platformMarkupUsd.toFixed(2)} (Bitnob load $${providerLoadUsd.toFixed(2)})`,
      metadata: {
        pricing,
        provider_load_usd: providerLoadUsd,
        platform_markup_usd: platformMarkupUsd,
        provider_card_id: cardMetadata.provider_card_id,
        provider: 'bitnob',
        ledger: 'bitnob',
      },
    });
  } catch (feeErr) {
    console.warn('[cardWallet] platform fee record skipped:', feeErr.message);
  }

  await TransactionLog.create({
    userId,
    type: 'card_issued',
    direction: 'neutral',
    amountUsd: pricing.total_usd_required,
    referenceType: 'cards_v2',
    referenceId: card.id,
    description: card.status === 'active'
      ? `Standard Card issued — ${formatBitnobUsdt(requiredUsdt)} from Bitnob wallet`
      : `Standard Card purchase paid — ${formatBitnobUsdt(requiredUsdt)}; awaiting card details`,
    createdBy: 'user',
    metadata: {
      purpose: 'card_issuance',
      pricing,
      paid_from_wallet: true,
      wallet: 'bitnob_usdt',
      ledger: 'bitnob',
      auto_issued: true,
      provider: 'bitnob',
      provider_card_id: cardMetadata.provider_card_id,
      card_request_id: card.id,
      pending: card.status !== 'active',
    },
  });

  const updatedUser = await User.findById(userId);

  return {
    card,
    pricing,
    wallet_debit_usdt: requiredUsdt,
    wallet_type: 'bitnob_usdt',
    ledger: 'bitnob',
    balance_usdt: Number(updatedUser.balance_usdt ?? 0),
    balance_bitnob_usdt: Number(updatedUser.balance_bitnob_usdt ?? 0),
    pending: card.status !== 'active',
    issued: card.status === 'active',
    provider_card_id: cardMetadata.provider_card_id,
    customer_id: resolvedCustomerId,
    message: card.status === 'active' ? CARD_ISSUED_MESSAGE : CARD_REQUEST_PENDING_MESSAGE,
  };
}

/**
 * Reload: Instant cards debit Master Wallet; Standard cards debit Bitnob ledger.
 */
async function reloadCardFromUsdtWallet(userId, { cardId, amountUsdt }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const card = await Card.findById(cardId);
  if (!card || card.user_id !== userId) throw new Error('Card not found');
  if (card.status !== 'active') throw new Error('Only active cards can be reloaded');

  const cardMeta = parseRecordMetadata(card.metadata);
  const provider = String(cardMeta.provider || '').toLowerCase();
  const isStandard = provider === 'bitnob';
  // DB CHECK allows only mmk|usdt — ledger separation lives in pricing/metadata.
  const walletType = 'usdt';
  const ledger = isStandard ? 'bitnob' : 'master_wallet';
  const fundingWallet = isStandard ? 'bitnob_usdt' : 'usdt';

  const settings = await getCardPricingSettings();
  const pricing = calculateCardReloadPricingUsdt(amountUsdt, settings);
  const requiredUsdt = pricing.deposit_usdt;

  if (isStandard) {
    await debitBitnobUsdt(userId, requiredUsdt, {
      description: `Standard Card reload hold — ${formatBitnobUsdt(requiredUsdt)} (pending admin approval)`,
      referenceType: 'cards_v2',
      referenceId: cardId,
      createdBy: 'user',
      purpose: 'standard_card_reload',
      metadata: {
        purpose: 'card_reload',
        pricing,
        card_id: cardId,
        wallet: 'bitnob_usdt',
        ledger: 'bitnob',
        pending: true,
        provider: 'bitnob',
      },
    });
  } else {
    const { debitUsdt } = require('./walletService');
    await debitUsdt(userId, requiredUsdt, {
      description: `Instant Card reload hold — ${formatUsdt(requiredUsdt)} (pending admin approval)`,
      referenceType: 'cards_v2',
      referenceId: cardId,
      createdBy: 'user',
      metadata: {
        purpose: 'card_reload',
        pricing,
        card_id: cardId,
        wallet: 'usdt',
        ledger: 'master_wallet',
        pending: true,
        provider: provider || 'kripicard',
      },
    });
  }

  const reloadRequest = await CardReloadRequest.create({
    userId,
    cardId,
    walletType,
    amountUsdt: requiredUsdt,
    netUsdToCard: pricing.net_usd_to_card,
    reloadFeeUsd: pricing.reload_fee_usd,
    grossUsd: pricing.gross_usd,
    pricing: {
      ...pricing,
      ledger,
      funding_wallet: fundingWallet,
      provider: provider || 'kripicard',
    },
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: pricing.net_usd_to_card,
    referenceType: 'card_reload_requests',
    referenceId: reloadRequest.id,
    description: isStandard
      ? `Standard Card reload from Bitnob wallet — ${formatBitnobUsdt(requiredUsdt)} (pending)`
      : `Instant Card reload from Master Wallet — ${formatUsdt(requiredUsdt)} (pending)`,
    createdBy: 'user',
    metadata: {
      pricing,
      paid_from_wallet: true,
      wallet: fundingWallet,
      ledger,
      pending: true,
      provider: provider || 'kripicard',
    },
  });

  const updatedUser = await User.findById(userId);

  return {
    pending: true,
    reload_request: CardReloadRequest.mapForClient(reloadRequest),
    reload_request_id: reloadRequest.id,
    pricing,
    wallet_debit_usdt: requiredUsdt,
    wallet_type: fundingWallet,
    ledger,
    balance_usdt: Number(updatedUser.balance_usdt ?? 0),
    balance_bitnob_usdt: Number(updatedUser.balance_bitnob_usdt ?? 0),
    message: RELOAD_PENDING_MESSAGE,
  };
}

module.exports = {
  purchaseCardFromUsdtWallet,
  reloadCardFromUsdtWallet,
  CARD_ISSUED_MESSAGE,
  CARD_REQUEST_PENDING_MESSAGE,
};
