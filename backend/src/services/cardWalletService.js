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
const { issueCardForUser, isSupabaseAdminEnabled } = require('./cardIssueService');
const { ensureSupabaseUserWallet } = require('./supabaseSyncService');
const {
  debitUsdtForCardPurchase,
  finalizeCardPurchaseWallet,
} = require('./supabaseWalletLedgerService');

const CARD_REQUEST_PENDING_MESSAGE =
  'Card request submitted. An admin will process your card shortly (usually within 15-30 mins).';

const CARD_ISSUED_MESSAGE =
  'Card issued successfully. Your virtual card is ready to use.';

/**
 * Built-in Kripicard BIN catalog shown in the Apply Card dropdown when
 * KRIPICARD_ALLOWED_BINS is unset. Override via env for account-specific BINs.
 */
const DEFAULT_KRIPICARD_BINS = [
  '539502',
  '525847',
  '441357',
  '493875',
  '428803',
  '493728',
];

function parseBinList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function uniqueBins(list) {
  const seen = new Set();
  const out = [];
  for (const bin of list) {
    const key = String(bin);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function resolveKripicardBin(requestedBin) {
  const requested = String(requestedBin || '').trim();
  const { default_bin: defaultBin, bins: allowed } = getKripicardBinOptions();

  const bin = requested || defaultBin;
  if (!bin) {
    const err = new Error(
      'Card BIN is required. Set KRIPICARD_DEFAULT_BIN / KRIPICARD_ALLOWED_BINS or pass bin in the request.'
    );
    err.code = 'INVALID_BIN';
    throw err;
  }

  // When an explicit allow-list is configured, enforce it.
  // Built-in catalog (no env override) still accepts any requested catalog BIN.
  if (allowed.length && !allowed.includes(String(bin))) {
    const err = new Error(`BIN ${bin} is not allowed. Allowed: ${allowed.join(', ')}`);
    err.code = 'INVALID_BIN';
    throw err;
  }

  return String(bin);
}

function getKripicardBinOptions() {
  const envDefault = String(process.env.KRIPICARD_DEFAULT_BIN || '').trim();
  const envAllowed = parseBinList(process.env.KRIPICARD_ALLOWED_BINS);
  const bins = uniqueBins(
    envAllowed.length ? envAllowed : [...DEFAULT_KRIPICARD_BINS]
  );
  const defaultBin = envDefault && bins.includes(envDefault)
    ? envDefault
    : (envDefault || bins[0] || null);

  // If env default is outside allow-list, still surface it first for operators.
  const withDefault = uniqueBins(
    defaultBin ? [defaultBin, ...bins] : bins
  );

  return {
    default_bin: defaultBin || withDefault[0] || null,
    bins: withDefault,
    source: envAllowed.length ? 'env' : 'default_catalog',
  };
}

async function purchaseCardFromUsdtWallet(userId, {
  initialLoadUsd,
  cardHolderName,
  note,
  bin,
  paymentRef,
}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const pending = await Card.findByUserId(userId, { status: 'pending' });
  if (pending.length) {
    throw new Error('You already have a pending card request');
  }

  const resolvedBin = resolveKripicardBin(bin);
  const nameOnCard = String(cardHolderName || user.name || '').trim();
  if (nameOnCard.length < 2) {
    const err = new Error('Cardholder name must be at least 2 characters');
    err.code = 'INVALID_NAME_ON_CARD';
    throw err;
  }

  const settings = await getCardPricingSettings();
  const pricing = calculateCardRequestPricingUsdt(initialLoadUsd, settings);
  const kripicardCostUsd = pricing.kripicard_cost_usd;
  const platformMarkupUsd = pricing.platform_markup_usd;
  const requiredUsdt = pricing.total_charge_usdt;
  const idempotencyKey = paymentRef
    || `usdt-issue-${userId}-${kripicardCostUsd}-${resolvedBin}-${Date.now()}`;

  if (!isSupabaseAdminEnabled()) {
    const err = new Error(
      'Card issuance requires Supabase. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  if (!String(process.env.KRIPICARD_API_KEY || '').trim()) {
    const err = new Error('KRIPICARD_API_KEY is not configured');
    err.code = 'KRIPICARD_NOT_CONFIGURED';
    throw err;
  }

  await ensureSupabaseUserWallet(userId, { syncIfExists: true });

  const debitDescription = `New card purchase — ${formatUsdt(requiredUsdt)} ($${kripicardCostUsd.toFixed(2)} card + $${platformMarkupUsd.toFixed(2)} fee)`;
  const debitMetadata = {
    purpose: 'card_issuance',
    pricing,
    wallet: 'usdt',
    auto_issue: true,
    kripicard_cost_usd: kripicardCostUsd,
    platform_markup_usd: platformMarkupUsd,
  };

  let journalId = idempotencyKey;
  let tursoDebited = false;

  const supabaseDebit = await debitUsdtForCardPurchase(userId, {
    totalAmountUsdt: requiredUsdt,
    kripicardCostUsd,
    platformMarkupUsd,
    idempotencyKey,
    description: debitDescription,
    metadata: debitMetadata,
  });
  journalId = supabaseDebit.journal_id;

  try {
    await debitUsdt(userId, requiredUsdt, {
      description: debitDescription,
      createdBy: 'user',
      journalId,
      metadata: debitMetadata,
    });
    tursoDebited = true;
  } catch (tursoErr) {
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
    throw tursoErr;
  }

  let issued;
  try {
    issued = await issueCardForUser({
      userId,
      nameOnCard,
      bin: resolvedBin,
      amount: kripicardCostUsd,
      currency: 'USD',
      paymentRef: idempotencyKey,
      idempotencyKey,
      metadata: {
        source: 'purchaseCardFromUsdtWallet',
        wallet_type: 'usdt',
        pricing,
        kripicard_cost_usd: kripicardCostUsd,
        platform_markup_usd: platformMarkupUsd,
        total_charge_usdt: requiredUsdt,
        note: note || null,
      },
    });
  } catch (issueErr) {
    try {
      await finalizeCardPurchaseWallet(journalId, {
        outcome: 'refunded',
        failureReason: issueErr.message,
        metadata: {
          code: issueErr.code || null,
          stage: 'kripicard_issue',
        },
      });
    } catch (refundErr) {
      console.error('[cardWallet] Supabase refund failed after issue error:', refundErr);
      issueErr.refund_failed = true;
      issueErr.refund_error = refundErr.message;
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
            supabase_journal_id: journalId,
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
  const cardNumber = providerCard.card_number || userCard.card_number;
  const expDate = providerCard.exp_date || userCard.exp_date || '—';
  const cvv = providerCard.cvv || userCard.cvv || '—';
  const balanceUsd = Number(
    providerCard.balance ?? userCard.balance ?? pricing.initial_load_usd
  );

  const cardMetadata = {
    pricing,
    kripicard_cost_usd: kripicardCostUsd,
    platform_markup_usd: platformMarkupUsd,
    total_charge_usdt: requiredUsdt,
    supabase_journal_id: journalId,
    payment_method: 'usdt_wallet',
    paid_from_wallet: true,
    wallet_type: 'usdt',
    wallet_debit_usdt: requiredUsdt,
    requested_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    request_status: 'approved',
    balance_usd: balanceUsd,
    provider: 'kripicard',
    provider_card_id: providerCard.card_id || userCard.card_id,
    bin: resolvedBin,
    supabase_user_card_id: userCard.id || null,
    auto_issued: true,
    issuance_mode: 'realtime_createcard',
  };

  let card;
  if (cardNumber) {
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
      adminNotes: note || 'Auto-issued via Kripicard (USDT wallet)',
      metadata: cardMetadata,
    });
  } else {
    card = await Card.requestPending({
      userId,
      cardHolderName: nameOnCard,
      userNote: note || 'Awaiting card details from Kripicard',
      metadata: {
        ...cardMetadata,
        request_status: 'pending_provider_details',
      },
    });
  }

  try {
    await finalizeCardPurchaseWallet(journalId, {
      outcome: 'completed',
      referenceId: card.id,
      metadata: {
        provider_card_id: cardMetadata.provider_card_id,
        card_status: card.status,
      },
    });
  } catch (finalizeErr) {
    console.error('[cardWallet] Supabase finalize completed failed:', finalizeErr);
  }

  try {
    await recordPlatformUsdFee(platformMarkupUsd, {
      feeType: PLATFORM_FEE_TYPES.CARD_ISSUE,
      userId,
      referenceType: 'cards_v2',
      referenceId: card.id,
      description: `Card issuance markup $${platformMarkupUsd.toFixed(2)} (Kripicard load $${kripicardCostUsd.toFixed(2)})`,
      metadata: {
        pricing,
        kripicard_cost_usd: kripicardCostUsd,
        platform_markup_usd: platformMarkupUsd,
        provider_card_id: cardMetadata.provider_card_id,
        bin: resolvedBin,
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
      ? `Virtual card issued via Kripicard — ${formatUsdt(requiredUsdt)} from USDT wallet`
      : `Card purchase paid — ${formatUsdt(requiredUsdt)}; awaiting provider card details`,
    createdBy: 'user',
    metadata: {
      purpose: 'card_issuance',
      pricing,
      paid_from_wallet: true,
      wallet: 'usdt',
      auto_issued: true,
      provider: 'kripicard',
      provider_card_id: cardMetadata.provider_card_id,
      bin: resolvedBin,
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
    bin: resolvedBin,
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
  resolveKripicardBin,
  getKripicardBinOptions,
  DEFAULT_KRIPICARD_BINS,
  CARD_ISSUED_MESSAGE,
};
