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
const { fetchAvailableBins } = require('../../../lib/kripicard');

const CARD_REQUEST_PENDING_MESSAGE =
  'Card request submitted. An admin will process your card shortly (usually within 15-30 mins).';

const CARD_ISSUED_MESSAGE =
  'Card issued successfully. Your virtual card is ready to use.';

/**
 * Live Kripicard BIN options for the Apply Card dropdown.
 * Prefer the provider /api/external/cards/bins catalog (active only).
 * Optional KRIPICARD_ALLOWED_BINS may intersect the live list, but must NEVER
 * replace it — that was how stale/inactive BINs kept appearing in the UI.
 *
 * When the live catalog is empty/unavailable, fall back to the known-active US
 * BIN below so Apply Card still works. Do NOT revive the old multi-BIN env
 * catalog (539502 / 525847 / …).
 */
const BIN_CACHE_TTL_MS = Number(process.env.KRIPICARD_BINS_CACHE_MS) || 60_000;
let binOptionsCache = {
  expiresAt: 0,
  value: null,
};

/**
 * Known-active Kripicard US BIN used when live fetch returns nothing.
 * Fee structure: card load (min $10) goes to Kripicard; $5 platform markup is
 * our custom issuance fee (USDT≈USD), retained in-platform.
 */
const KRIPICARD_KNOWN_ACTIVE_BIN_CATALOG = Object.freeze([
  Object.freeze({
    bin: '441357',
    brand: 'visa',
    country: 'US',
    currency: 'USD',
    label: 'US Visa 441357',
    min_load_usd: 10,
    issuance_fee_usd: 5,
    platform_markup_usd: 5,
    payment_currency: 'USDT',
    status: 'active',
  }),
]);

function buildKnownActiveBinFallback(pricingSettings = null) {
  // Prefer live admin pricing settings when provided; otherwise catalog defaults.
  const minLoad = Number(pricingSettings?.minimum_initial_deposit_usd);
  const issuanceFee = Number(pricingSettings?.card_issuance_fee_usd);
  const catalog = KRIPICARD_KNOWN_ACTIVE_BIN_CATALOG.map((entry) => ({
    ...entry,
    min_load_usd: Number.isFinite(minLoad) && minLoad > 0 ? minLoad : entry.min_load_usd,
    issuance_fee_usd:
      Number.isFinite(issuanceFee) && issuanceFee >= 0 ? issuanceFee : entry.issuance_fee_usd,
    platform_markup_usd:
      Number.isFinite(issuanceFee) && issuanceFee >= 0 ? issuanceFee : entry.platform_markup_usd,
  }));
  const bins = uniqueBins(catalog.map((entry) => entry.bin));
  return {
    default_bin: bins[0] || null,
    bins,
    source: 'builtin_fallback',
    details: catalog,
    catalog,
    raw_keys: [],
    error: null,
  };
}

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

function resetKripicardBinCacheForTests() {
  binOptionsCache = { expiresAt: 0, value: null };
}

function envBinOptions() {
  const envDefault = String(process.env.KRIPICARD_DEFAULT_BIN || '').trim();
  const envAllowed = parseBinList(process.env.KRIPICARD_ALLOWED_BINS);
  const bins = uniqueBins(envAllowed);
  const defaultBin = envDefault && (!bins.length || bins.includes(envDefault))
    ? envDefault
    : (bins[0] || envDefault || null);
  const withDefault = uniqueBins(defaultBin ? [defaultBin, ...bins] : bins);
  return {
    default_bin: defaultBin || withDefault[0] || null,
    bins: withDefault,
    source: bins.length ? 'env' : 'env_empty',
    details: [],
  };
}

/**
 * Resolve BIN options from Kripicard's live API (active BINs only).
 * Never falls back to KRIPICARD_ALLOWED_BINS for the UI — that env list still
 * contains inactive BINs in many deploys. Env allow-list only intersects a
 * successful live response.
 *
 * If the live catalog is empty/unavailable, use the known-active US BIN
 * (441357) with its fee/markup structure so the dropdown stays usable.
 */
async function getKripicardBinOptions({ forceRefresh = false, pricingSettings = null } = {}) {
  const now = Date.now();
  if (!forceRefresh && binOptionsCache.value && binOptionsCache.expiresAt > now) {
    return binOptionsCache.value;
  }

  const env = envBinOptions();
  let liveBins = [];
  let details = [];
  let source = 'kripicard_api';
  let apiError = null;
  let rawKeys = [];

  try {
    const live = await fetchAvailableBins();
    liveBins = uniqueBins(live.bins || []);
    details = Array.isArray(live.details) ? live.details : [];
    rawKeys = Array.isArray(live.raw_keys) ? live.raw_keys : [];
  } catch (err) {
    apiError = err;
    console.warn(
      '[cardWallet] Kripicard BIN fetch failed:',
      err && err.code ? `${err.code}: ${err.message}` : err.message
    );
  }

  let bins = liveBins;
  if (bins.length && env.bins.length) {
    const allow = new Set(env.bins);
    const filtered = bins.filter((b) => allow.has(b));
    // Only apply the env intersect when it still leaves at least one live BIN.
    // An outdated allow-list must not wipe (or replace) the live catalog.
    if (filtered.length) {
      bins = filtered;
      source = 'kripicard_api+env';
    } else {
      console.warn(
        '[cardWallet] KRIPICARD_ALLOWED_BINS matched no live BINs; ignoring env allow-list'
      );
      source = 'kripicard_api';
    }
  } else if (!bins.length) {
    // Live catalog empty/failed — use known-active US BIN (not the stale env list).
    const fallback = buildKnownActiveBinFallback(pricingSettings);
    console.warn(
      `[cardWallet] Live Kripicard BINs empty (${apiError ? 'fetch_error' : 'empty_catalog'}); ` +
        `using builtin fallback BIN ${fallback.bins.join(',')}`
    );
    const value = {
      ...fallback,
      error: apiError
        ? { code: apiError.code || 'KRIPICARD_BINS_FETCH_FAILED', message: apiError.message }
        : null,
      fallback_reason: apiError ? 'fetch_error' : 'empty_catalog',
    };
    binOptionsCache = {
      expiresAt: now + BIN_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  const envDefault = String(process.env.KRIPICARD_DEFAULT_BIN || '').trim();
  const defaultBin = envDefault && bins.includes(envDefault)
    ? envDefault
    : (bins[0] || null);

  const value = {
    default_bin: defaultBin,
    bins: uniqueBins(defaultBin ? [defaultBin, ...bins] : bins),
    source,
    details,
    catalog: details,
    raw_keys: rawKeys,
    error: apiError
      ? { code: apiError.code || 'KRIPICARD_BINS_FETCH_FAILED', message: apiError.message }
      : null,
  };

  binOptionsCache = {
    expiresAt: now + BIN_CACHE_TTL_MS,
    value,
  };
  return value;
}

async function resolveKripicardBin(requestedBin) {
  const requested = String(requestedBin || '').trim();
  const {
    default_bin: defaultBin,
    bins: allowed,
    source,
  } = await getKripicardBinOptions();

  const bin = requested || defaultBin;
  if (!bin) {
    const err = new Error(
      'Card BIN is required. No active Kripicard BINs are available right now.'
    );
    err.code = 'INVALID_BIN';
    throw err;
  }

  // Resolved catalog (live or known-active builtin fallback) is authoritative.
  // Do not accept arbitrary env BINs outside that list.
  if (!allowed.length || !allowed.includes(String(bin))) {
    const err = new Error(
      `BIN ${bin} is not available (${source}). Available: ${allowed.join(', ') || 'none'}`
    );
    err.code = 'INVALID_BIN';
    throw err;
  }

  return String(bin);
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

  const resolvedBin = await resolveKripicardBin(bin);
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
  resetKripicardBinCacheForTests,
  envBinOptions,
  buildKnownActiveBinFallback,
  KRIPICARD_KNOWN_ACTIVE_BIN_CATALOG,
  CARD_ISSUED_MESSAGE,
};
