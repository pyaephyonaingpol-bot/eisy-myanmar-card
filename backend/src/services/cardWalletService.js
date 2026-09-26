const Card = require('../models/Card');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const {
  getCardPricingSettings,
  calculateCardRequestPricingUsdt,
  calculateCardReloadPricingUsdt,
} = require('./settingsService');
const { debitUsdt, creditUsdt, formatUsdt } = require('./walletService');
const CardReloadRequest = require('../models/CardReloadRequest');
const { RELOAD_PENDING_MESSAGE } = require('./cardReloadApprovalService');
const { recordPlatformUsdFee, PLATFORM_FEE_TYPES } = require('./platformRevenueService');
const {
  issueCardForUser,
  isSupabaseAdminEnabled,
  resolveBitnobCustomerId,
  assertBitnobConfigured,
} = require('./cardIssueService');
const { ensureSupabaseUserWallet } = require('./supabaseSyncService');
const {
  debitUsdtForCardPurchase,
  finalizeCardPurchaseWallet,
} = require('./supabaseWalletLedgerService');

const CARD_REQUEST_PENDING_MESSAGE =
  'Card request submitted. Provider is provisioning your virtual card details.';

const CARD_ISSUED_MESSAGE =
  'Card issued successfully. Your virtual card is ready to use.';

/**
 * Purchase + auto-issue a Bitnob virtual card from the user's USDT wallet.
 * Debits total charge (card load + platform fees), then creates via Bitnob.
 * Only the card-load portion is sent to Bitnob; fees stay on-platform.
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
      'Bitnob customer_id is required. Complete Card KYC first, or set BITNOB_DEFAULT_CUSTOMER_ID.'
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
    || `usdt-issue-${userId}-${providerLoadUsd}-${Date.now()}`;

  if (!isSupabaseAdminEnabled()) {
    const err = new Error(
      'Card issuance requires Supabase. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  assertBitnobConfigured();

  await ensureSupabaseUserWallet(userId, { syncIfExists: true });

  const debitDescription = `New card purchase — ${formatUsdt(requiredUsdt)} ($${providerLoadUsd.toFixed(2)} load + $${Number(pricing.issuance_fee_usd || 0).toFixed(2)} issuance + $${Number(pricing.funding_fee_usd || 0).toFixed(2)} funding + $${Number(pricing.processing_fee_usd || 0).toFixed(2)} processing)`;
  const debitMetadata = {
    purpose: 'card_issuance',
    pricing,
    wallet: 'usdt',
    auto_issue: true,
    provider: 'bitnob',
    provider_load_usd: providerLoadUsd,
    platform_markup_usd: platformMarkupUsd,
  };

  let journalId = idempotencyKey;
  let tursoDebited = false;
  let supabaseAtomicDebit = false;

  try {
    const supabaseDebit = await debitUsdtForCardPurchase(userId, {
      totalAmountUsdt: requiredUsdt,
      providerLoadUsd,
      platformMarkupUsd,
      idempotencyKey,
      description: debitDescription,
      metadata: debitMetadata,
    });
    journalId = supabaseDebit.journal_id;
    supabaseAtomicDebit = true;
  } catch (rpcErr) {
    if (rpcErr.code !== 'SUPABASE_CARD_PURCHASE_RPC_MISSING') {
      throw rpcErr;
    }
    console.warn(
      '[cardWallet] Supabase card-purchase RPC missing — using Turso debit fallback. '
      + 'Apply supabase/wallet_card_purchase.sql for atomic ledger.'
    );
  }

  try {
    await debitUsdt(userId, requiredUsdt, {
      description: debitDescription,
      createdBy: 'user',
      journalId,
      metadata: {
        ...debitMetadata,
        supabase_atomic_debit: supabaseAtomicDebit,
      },
    });
    tursoDebited = true;
  } catch (tursoErr) {
    if (supabaseAtomicDebit) {
      try {
        await finalizeCardPurchaseWallet(journalId, {
          outcome: 'refunded',
          failureReason: `Local ledger sync failed: ${tursoErr.message}`,
          metadata: { code: tursoErr.code || null, stage: 'turso_mirror_debit' },
        });
      } catch (refundErr) {
        console.error('[cardWallet] Supabase refund failed after Turso debit error:', refundErr);
        tursoErr.refund_failed = true;
        tursoErr.refund_error = refundErr.message;
      }
    }
    throw tursoErr;
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
        source: 'purchaseCardFromUsdtWallet',
        wallet_type: 'usdt',
        pricing,
        provider_load_usd: providerLoadUsd,
        platform_markup_usd: platformMarkupUsd,
        total_charge_usdt: requiredUsdt,
        note: note || null,
        supabase_atomic_debit: supabaseAtomicDebit,
      },
    });
  } catch (issueErr) {
    if (supabaseAtomicDebit) {
      try {
        await finalizeCardPurchaseWallet(journalId, {
          outcome: 'refunded',
          failureReason: issueErr.message,
          metadata: {
            code: issueErr.code || null,
            stage: 'bitnob_issue',
          },
        });
      } catch (refundErr) {
        console.error('[cardWallet] Supabase refund failed after issue error:', refundErr);
        issueErr.refund_failed = true;
        issueErr.refund_error = refundErr.message;
      }
    }

    if (tursoDebited) {
      try {
        await creditUsdt(userId, requiredUsdt, {
          description: `Card issuance refund — ${formatUsdt(requiredUsdt)} (provider issue failed)`,
          createdBy: 'system',
          journalId: `${journalId}-refund`,
          metadata: {
            purpose: 'card_issuance_refund',
            reason: issueErr.message,
            code: issueErr.code || null,
            supabase_journal_id: supabaseAtomicDebit ? journalId : null,
          },
        });
      } catch (tursoRefundErr) {
        console.error('[cardWallet] Turso refund failed after issue error:', tursoRefundErr);
        issueErr.refund_failed = true;
        issueErr.refund_error = tursoRefundErr.message;
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
    supabase_journal_id: journalId,
    supabase_atomic_debit: supabaseAtomicDebit,
    payment_method: 'usdt_wallet',
    paid_from_wallet: true,
    wallet_type: 'usdt',
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
      adminNotes: note || 'Auto-issued via Bitnob (USDT wallet)',
      metadata: cardMetadata,
    });
  } else {
    card = await Card.requestPending({
      userId,
      cardHolderName: nameOnCard,
      userNote: note || 'Awaiting card details from Bitnob',
      metadata: {
        ...cardMetadata,
        request_status: 'pending_provider_details',
      },
    });
  }

  try {
    if (supabaseAtomicDebit) {
      await finalizeCardPurchaseWallet(journalId, {
        outcome: 'completed',
        referenceId: card.id,
        metadata: {
          provider_card_id: cardMetadata.provider_card_id,
          card_status: card.status,
        },
      });
    }
  } catch (finalizeErr) {
    console.error('[cardWallet] Supabase finalize completed failed:', finalizeErr);
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
      ? `Virtual card issued via Bitnob — ${formatUsdt(requiredUsdt)} from USDT wallet`
      : `Card purchase paid — ${formatUsdt(requiredUsdt)}; awaiting Bitnob card details`,
    createdBy: 'user',
    metadata: {
      purpose: 'card_issuance',
      pricing,
      paid_from_wallet: true,
      wallet: 'usdt',
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
    balance_usdt: Number(updatedUser.balance_usdt ?? 0),
    pending: card.status !== 'active',
    issued: card.status === 'active',
    provider_card_id: cardMetadata.provider_card_id,
    customer_id: resolvedCustomerId,
    message: card.status === 'active' ? CARD_ISSUED_MESSAGE : CARD_REQUEST_PENDING_MESSAGE,
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
  purchaseCardFromUsdtWallet,
  reloadCardFromUsdtWallet,
  CARD_ISSUED_MESSAGE,
  CARD_REQUEST_PENDING_MESSAGE,
};
