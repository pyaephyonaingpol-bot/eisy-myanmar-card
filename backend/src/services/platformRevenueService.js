const { getDb } = require('../db');
const PlatformFeeEvent = require('../models/PlatformFeeEvent');
const TransactionLog = require('../models/TransactionLog');
const { PLATFORM_FEE_TYPES, USDT_FEE_TYPES } = require('../constants/platformFeeTypes');
const { getSetting, setSetting } = require('./settingsService');
const { formatUsdt } = require('./walletService');

const SUB_BALANCE_KEYS = {
  [PLATFORM_FEE_TYPES.P2P]: 'platform_revenue_p2p_usdt',
  [PLATFORM_FEE_TYPES.WITHDRAWAL]: 'platform_revenue_withdrawal_usdt',
  [PLATFORM_FEE_TYPES.CARD_RELOAD]: 'platform_revenue_card_reload_usd',
  [PLATFORM_FEE_TYPES.CARD_ISSUE]: 'platform_revenue_card_issue_usd',
};

async function getPlatformUsdtRevenueBalance() {
  const raw = await getSetting('platform_usdt_revenue_balance');
  return Math.round((parseFloat(raw) || 0) * 100) / 100;
}

async function getSubBalance(feeType) {
  const db = getDb();
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM platform_fee_events WHERE fee_type = ?`,
    feeType
  );
  return Math.round((parseFloat(row?.total) || 0) * 100) / 100;
}

async function incrementSubBalance(feeType, amount) {
  const key = SUB_BALANCE_KEYS[feeType];
  if (!key) return;
  const current = await getSubBalance(feeType);
  const next = Math.round((current + amount) * 100) / 100;
  await setSetting(key, next);
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
  const parsed = parseFloat(amount);
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
    currency,
    referenceType,
    referenceId,
    relatedUserId,
    description,
    metadata,
    collectedAt,
    createdBy,
  });

  await incrementSubBalance(feeType, parsed);
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
  const amount = parseFloat(amountUsdt);
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
      return { balance_before: current, balance_after: current, duplicate: true };
    }
  }

  const db = getDb();
  await db.run('BEGIN');
  try {
    const current = await getPlatformUsdtRevenueBalance();
    const balanceAfter = Math.round((current + amount) * 100) / 100;
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
          ...(metadata || {}),
        },
      });
    }

    await db.run('COMMIT');
    return { balance_before: current, balance_after: balanceAfter };
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

async function recordPlatformUsdFee(amountUsd, {
  feeType,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
} = {}) {
  const amount = parseFloat(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const db = getDb();
  await db.run('BEGIN');
  try {
    const event = await recordPlatformFeeEvent({
      feeType,
      amount,
      currency: 'USD',
      referenceType,
      referenceId,
      relatedUserId,
      description,
      metadata,
      createdBy,
    });

    if (relatedUserId) {
      await TransactionLog.create({
        userId: relatedUserId,
        type: 'other',
        direction: 'neutral',
        amountUsd: amount,
        referenceType,
        referenceId,
        description: description || `Platform fee (${feeType}) $${amount.toFixed(2)}`,
        createdBy,
        metadata: {
          wallet: 'platform_revenue',
          fee_type: feeType,
          fee_category: feeType,
          currency: 'USD',
          ...(metadata || {}),
        },
      });
    }

    await db.run('COMMIT');
    return event;
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

module.exports = {
  PLATFORM_FEE_TYPES,
  getPlatformUsdtRevenueBalance,
  getSubBalance,
  recordPlatformFeeEvent,
  creditPlatformUsdtRevenue,
  recordPlatformUsdFee,
};
