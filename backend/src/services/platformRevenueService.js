const { getDb } = require('../db');
const PlatformFeeEvent = require('../models/PlatformFeeEvent');
const TransactionLog = require('../models/TransactionLog');
const {
  PLATFORM_FEE_TYPES,
  USDT_FEE_TYPES,
  MMK_FEE_TYPES,
} = require('../constants/platformFeeTypes');
const { getSetting, setSetting } = require('./settingsService');
const { formatUsdt, formatMmk } = require('./walletService');

const SUB_BALANCE_KEYS = {
  [PLATFORM_FEE_TYPES.P2P]: 'platform_revenue_p2p_usdt',
  [PLATFORM_FEE_TYPES.WITHDRAWAL]: 'platform_revenue_withdrawal_usdt',
  [PLATFORM_FEE_TYPES.DEPOSIT]: 'platform_revenue_deposit_usdt',
  [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'platform_revenue_card_reload_usdt',
  [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'platform_revenue_card_issue_usdt',
};

const MMK_SUB_BALANCE_KEYS = {
  [PLATFORM_FEE_TYPES.WITHDRAWAL]: 'platform_revenue_withdrawal_mmk',
  [PLATFORM_FEE_TYPES.DEPOSIT]: 'platform_revenue_deposit_mmk',
  [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'platform_revenue_card_reload_mmk',
  [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'platform_revenue_card_issue_mmk',
};

function roundUsdt(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function roundMmk(n) {
  return Math.round(Number(n) || 0);
}

async function getPlatformUsdtRevenueBalance() {
  const raw = await getSetting('platform_usdt_revenue_balance');
  return roundUsdt(raw);
}

async function getPlatformMmkRevenueBalance() {
  const raw = await getSetting('platform_mmk_revenue_balance');
  return roundMmk(raw);
}

async function getSubBalance(feeType, currency) {
  const db = getDb();
  const cur = currency ? String(currency).toUpperCase() : null;
  if (cur) {
    const row = await db.get(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_fee_events WHERE fee_type = ? AND UPPER(currency) = ?`,
      feeType,
      cur
    );
    if (cur === 'MMK') return roundMmk(row?.total);
    return roundUsdt(row?.total);
  }
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_fee_events WHERE fee_type = ?`,
    feeType
  );
  return roundUsdt(row?.total);
}

async function incrementSubBalance(feeType, amount, currency) {
  const cur = String(currency || '').toUpperCase();
  if (cur === 'MMK') {
    const key = MMK_SUB_BALANCE_KEYS[feeType];
    if (!key) return;
    const current = await getSubBalance(feeType, 'MMK');
    await setSetting(key, roundMmk(current + amount));
    return;
  }
  if (cur === 'USDT') {
    const key = SUB_BALANCE_KEYS[feeType];
    if (!key) return;
    const current = await getSubBalance(feeType, 'USDT');
    await setSetting(key, roundUsdt(current + amount));
  }
  // Legacy USD events: keep optional USD keys for old analytics only
  if (cur === 'USD') {
    const legacyKey = {
      [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'platform_revenue_card_reload_usd',
      [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'platform_revenue_card_issue_usd',
    }[feeType];
    if (!legacyKey) return;
    const current = await getSubBalance(feeType, 'USD');
    await setSetting(legacyKey, roundUsdt(current + amount));
  }
}

async function recordPlatformFeeEvent({
  feeType,
  amount,
  currency,
  referenceType,
  referenceId,
  relatedUserId,
  description,
  metadata,
  collectedAt,
  createdBy = 'system',
} = {}) {
  const cur = String(currency || '').toUpperCase();
  const parsed = cur === 'MMK' ? roundMmk(amount) : roundUsdt(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Platform fee amount must be a positive number');
  }
  if (!feeType || !currency) {
    throw new Error('Platform fee requires feeType and currency');
  }

  const existing = referenceType && referenceId != null
    ? await PlatformFeeEvent.findByReference(referenceType, referenceId)
    : null;
  if (existing) {
    return PlatformFeeEvent.mapForClient(existing);
  }

  const row = await PlatformFeeEvent.create({
    feeType,
    amount: parsed,
    currency: cur,
    referenceType,
    referenceId,
    relatedUserId,
    description,
    metadata,
    collectedAt,
    createdBy,
  });

  await incrementSubBalance(feeType, parsed, cur);
  return PlatformFeeEvent.mapForClient(row);
}

async function creditPlatformUsdtRevenue(amountUsdt, {
  feeType = PLATFORM_FEE_TYPES.P2P,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
} = {}) {
  const amount = roundUsdt(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Platform revenue credit must be a positive number');
  }
  if (!USDT_FEE_TYPES.has(feeType)) {
    throw new Error(`Invalid USDT platform fee type: ${feeType}`);
  }

  if (referenceType && referenceId != null) {
    const existing = await PlatformFeeEvent.findByReference(referenceType, referenceId);
    if (existing) {
      const current = await getPlatformUsdtRevenueBalance();
      return { balance_before: current, balance_after: current, duplicate: true, currency: 'USDT' };
    }
  }

  const db = getDb();
  await db.run('BEGIN');
  try {
    const current = await getPlatformUsdtRevenueBalance();
    const balanceAfter = roundUsdt(current + amount);
    await setSetting('platform_usdt_revenue_balance', balanceAfter);

    await recordPlatformFeeEvent({
      feeType,
      amount,
      currency: 'USDT',
      referenceType,
      referenceId,
      relatedUserId,
      description: description || `Platform USDT revenue +${formatUsdt(amount)}`,
      metadata: {
        wallet: 'platform_revenue',
        account: 'platform_usdt_revenue',
        profit_currency: 'USDT',
        ...(metadata || {}),
      },
      createdBy,
    });

    if (relatedUserId) {
      await TransactionLog.create({
        userId: relatedUserId,
        type: 'other',
        direction: 'credit',
        amountUsd: amount,
        balanceBefore: current,
        balanceAfter,
        referenceType,
        referenceId,
        description: description || `Platform USDT revenue +${formatUsdt(amount)}`,
        createdBy,
        metadata: {
          wallet: 'platform_revenue',
          account: 'platform_usdt_revenue',
          fee_type: feeType,
          fee_category: feeType,
          profit_currency: 'USDT',
          ...(metadata || {}),
        },
      });
    }

    await db.run('COMMIT');
    return { balance_before: current, balance_after: balanceAfter, currency: 'USDT' };
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

async function creditPlatformMmkRevenue(amountMmk, {
  feeType = PLATFORM_FEE_TYPES.DEPOSIT,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
} = {}) {
  const amount = roundMmk(amountMmk);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Platform MMK revenue credit must be a positive number');
  }
  if (!MMK_FEE_TYPES.has(feeType)) {
    throw new Error(`Invalid MMK platform fee type: ${feeType}`);
  }

  if (referenceType && referenceId != null) {
    const existing = await PlatformFeeEvent.findByReference(referenceType, referenceId);
    if (existing) {
      const current = await getPlatformMmkRevenueBalance();
      return { balance_before: current, balance_after: current, duplicate: true, currency: 'MMK' };
    }
  }

  const db = getDb();
  await db.run('BEGIN');
  try {
    const current = await getPlatformMmkRevenueBalance();
    const balanceAfter = roundMmk(current + amount);
    await setSetting('platform_mmk_revenue_balance', balanceAfter);

    await recordPlatformFeeEvent({
      feeType,
      amount,
      currency: 'MMK',
      referenceType,
      referenceId,
      relatedUserId,
      description: description || `Platform MMK revenue +${formatMmk(amount)}`,
      metadata: {
        wallet: 'platform_revenue',
        account: 'platform_mmk_revenue',
        profit_currency: 'MMK',
        ...(metadata || {}),
      },
      createdBy,
    });

    if (relatedUserId) {
      await TransactionLog.create({
        userId: relatedUserId,
        type: 'other',
        direction: 'credit',
        amountMmk: amount,
        balanceBefore: current,
        balanceAfter,
        referenceType,
        referenceId,
        description: description || `Platform MMK revenue +${formatMmk(amount)}`,
        createdBy,
        metadata: {
          wallet: 'platform_revenue',
          account: 'platform_mmk_revenue',
          fee_type: feeType,
          fee_category: feeType,
          profit_currency: 'MMK',
          ...(metadata || {}),
        },
      });
    }

    await db.run('COMMIT');
    return { balance_before: current, balance_after: balanceAfter, currency: 'MMK' };
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

/**
 * Record card (reload/issue) profit into the correct currency ledger.
 * Never mixes: MMK wallet → MMK ledger; USDT wallet → USDT ledger.
 */
async function recordCardProfitByWallet({
  walletType,
  amountUsd,
  mmkRate,
  feeType,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
} = {}) {
  const profitUsd = roundUsdt(amountUsd);
  if (!Number.isFinite(profitUsd) || profitUsd <= 0) return null;

  const wallet = String(walletType || 'mmk').toLowerCase();
  const rate = Number(mmkRate) > 0 ? Number(mmkRate) : 4500;
  const baseMeta = {
    wallet_type: wallet === 'usdt' ? 'usdt' : 'mmk',
    net_profit_usd: profitUsd,
    mmk_to_usd_rate: rate,
    ...(metadata || {}),
  };

  if (wallet === 'usdt') {
    return creditPlatformUsdtRevenue(profitUsd, {
      feeType,
      description: description || `Card profit ${formatUsdt(profitUsd)} (USDT wallet)`,
      referenceType,
      referenceId,
      relatedUserId,
      createdBy,
      metadata: baseMeta,
    });
  }

  const amountMmk = roundMmk(profitUsd * rate);
  return creditPlatformMmkRevenue(amountMmk, {
    feeType,
    description: description
      || `Card profit ${formatMmk(amountMmk)} (MMK wallet, $${profitUsd.toFixed(2)} @ ${rate})`,
    referenceType,
    referenceId,
    relatedUserId,
    createdBy,
    metadata: {
      ...baseMeta,
      net_profit_mmk: amountMmk,
    },
  });
}

/** @deprecated Prefer recordCardProfitByWallet / creditPlatform{Usdt,Mmk}Revenue */
async function recordPlatformUsdFee(amountUsd, {
  feeType,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
} = {}) {
  const amount = roundUsdt(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const wallet = String(metadata?.wallet_type || metadata?.wallet || 'mmk').toLowerCase();
  let mmkRate = Number(metadata?.mmk_to_usd_rate);
  if (!(mmkRate > 0)) {
    try {
      const { getCardPricingSettings } = require('./settingsService');
      const settings = await getCardPricingSettings();
      mmkRate = settings.mmk_to_usd_rate || 4500;
    } catch (_) {
      mmkRate = 4500;
    }
  }

  return recordCardProfitByWallet({
    walletType: wallet === 'usdt' ? 'usdt' : 'mmk',
    amountUsd: amount,
    mmkRate,
    feeType,
    description,
    referenceType,
    referenceId,
    relatedUserId,
    metadata,
    createdBy,
  });
}

module.exports = {
  PLATFORM_FEE_TYPES,
  getPlatformUsdtRevenueBalance,
  getPlatformMmkRevenueBalance,
  getSubBalance,
  recordPlatformFeeEvent,
  creditPlatformUsdtRevenue,
  creditPlatformMmkRevenue,
  recordCardProfitByWallet,
  recordPlatformUsdFee,
};
