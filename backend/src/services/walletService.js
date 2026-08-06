const { getDb } = require('../db');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const { getCardPricingSettings } = require('./settingsService');
const { syncUserWalletById } = require('./supabaseSyncService');

function syncWalletAfter(userId) {
  syncUserWalletById(userId).catch((err) => console.warn('[supabase] wallet sync:', err.message));
}

function formatMmk(amount) {
  const n = Number(amount) || 0;
  return `Ks ${Math.round(n).toLocaleString()} MMK`;
}

function formatUsdt(amount) {
  const n = Number(amount) || 0;
  return `$ ${n.toFixed(2)} USDT`;
}

/** MMK wallet debits are restricted to virtual card issuance and reloads only. */
const MMK_WALLET_ALLOWED_DEBIT_PURPOSES = new Set(['card_issuance', 'card_reload']);

function assertMmkDebitAllowed({ createdBy, metadata } = {}) {
  if (createdBy === 'admin' || createdBy === 'system') return;
  if (metadata?.adjustment) return;
  const purpose = metadata?.purpose;
  if (purpose && MMK_WALLET_ALLOWED_DEBIT_PURPOSES.has(purpose)) return;
  const err = new Error(
    'MMK wallet can only be used for virtual card issuance and card reloads. '
    + 'P2P USDT trades use external KPay/WavePay/Bank transfers — not your internal MMK wallet.'
  );
  err.code = 'MMK_WALLET_RESTRICTED';
  throw err;
}

/** Convert any remaining legacy USD wallet balance into MMK and zero the USD field. */
async function migrateLegacyUsdToMmk(userId) {
  const user = await User.findById(userId);
  if (!user) return { migrated: false };

  const legacyUsd = Number(user.balance ?? 0);
  if (!Number.isFinite(legacyUsd) || legacyUsd <= 0.001) {
    return { migrated: false };
  }

  const settings = await getCardPricingSettings();
  const rate = settings.mmk_to_usd_rate || 4500;
  const mmkAmount = Math.round(legacyUsd * rate);
  const balanceBeforeMmk = Number(user.balance_mmk ?? 0);
  const balanceAfterMmk = balanceBeforeMmk + mmkAmount;

  const db = getDb();
  await db.run('BEGIN');
  try {
    await db.run(`
      UPDATE users
      SET balance_mmk = COALESCE(balance_mmk, 0) + ?,
          balance = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `, mmkAmount, userId);
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  await TransactionLog.create({
    userId,
    type: 'balance_credit',
    direction: 'credit',
    amountUsd: legacyUsd,
    amountMmk: mmkAmount,
    balanceBefore: balanceBeforeMmk,
    balanceAfter: balanceAfterMmk,
    description: `Legacy USD wallet converted to MMK ($${legacyUsd.toFixed(2)} → ${formatMmk(mmkAmount)})`,
    createdBy: 'system',
    metadata: {
      wallet: 'mmk',
      migration: 'legacy_usd_to_mmk',
      rate,
      legacy_usd: legacyUsd,
    },
  });

  console.log(`[wallet] Migrated legacy USD for user ${userId}: $${legacyUsd.toFixed(2)} → ${formatMmk(mmkAmount)}`);

  return {
    migrated: true,
    legacy_usd: legacyUsd,
    mmk_credited: mmkAmount,
    mmk_formatted: formatMmk(mmkAmount),
    rate,
  };
}

/** One-time batch migration for all users with leftover USD balance. */
async function migrateAllLegacyUsdBalances() {
  const db = getDb();
  const users = await db.all('SELECT id, balance FROM users WHERE balance > 0.001');
  if (!users.length) return { count: 0 };

  let count = 0;
  for (const u of users) {
    const result = await migrateLegacyUsdToMmk(u.id);
    if (result.migrated) count += 1;
  }
  if (count > 0) {
    console.log(`[wallet] Batch migrated legacy USD for ${count} user(s)`);
  }
  return { count };
}

async function getMmkBalance(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return Number(user.balance_mmk ?? 0);
}

async function creditMmk(userId, amountMmk, {
  description,
  referenceType,
  referenceId,
  createdBy = 'system',
  metadata,
} = {}) {
  const amount = parseFloat(amountMmk);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Credit amount must be a positive number');
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const balanceBefore = Number(user.balance_mmk ?? 0);
  const balanceAfter = balanceBefore + amount;

  const db = getDb();
  await db.run(
    `UPDATE users SET balance_mmk = ?, updated_at = datetime('now') WHERE id = ?`,
    balanceAfter,
    userId
  );

  await TransactionLog.create({
    userId,
    type: 'balance_credit',
    direction: 'credit',
    amountMmk: amount,
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    description: description || `MMK wallet credited ${formatMmk(amount)}`,
    createdBy,
    metadata: { wallet: 'mmk', ...(metadata || {}) },
  });

  syncWalletAfter(userId);
  return User.findById(userId);
}

async function debitMmk(userId, amountMmk, {
  description,
  referenceType,
  referenceId,
  createdBy = 'system',
  metadata,
  allowInsufficient = false,
} = {}) {
  const amount = parseFloat(amountMmk);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Debit amount must be a positive number');
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  assertMmkDebitAllowed({ createdBy, metadata });

  const balanceBefore = Number(user.balance_mmk ?? 0);
  if (balanceBefore < amount && !allowInsufficient) {
    const err = new Error(
      `Insufficient MMK wallet balance. Required ${formatMmk(amount)}, available ${formatMmk(balanceBefore)}`
    );
    err.code = 'INSUFFICIENT_MMK_BALANCE';
    err.required_mmk = amount;
    err.available_mmk = balanceBefore;
    throw err;
  }

  const balanceAfter = balanceBefore - amount;
  const db = getDb();
  await db.run(
    `UPDATE users SET balance_mmk = ?, updated_at = datetime('now') WHERE id = ?`,
    balanceAfter,
    userId
  );

  await TransactionLog.create({
    userId,
    type: 'balance_debit',
    direction: 'debit',
    amountMmk: amount,
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    description: description || `MMK wallet debited ${formatMmk(amount)}`,
    createdBy,
    metadata: { wallet: 'mmk', ...(metadata || {}) },
  });

  syncWalletAfter(userId);
  return User.findById(userId);
}

async function getUsdtBalance(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return Number(user.balance_usdt ?? 0);
}

async function creditUsdt(userId, amountUsdt, opts = {}) {
  const { creditAvailable } = require('./usdtLedgerService');
  return creditAvailable(userId, amountUsdt, opts);
}

async function debitUsdt(userId, amountUsdt, opts = {}) {
  const { debitAvailable } = require('./usdtLedgerService');
  return debitAvailable(userId, amountUsdt, opts);
}

async function adjustUsdt(userId, deltaUsdt, reason, createdBy = 'admin') {
  const delta = parseFloat(deltaUsdt);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Adjustment amount must be a non-zero number');
  }

  if (delta > 0) {
    return creditUsdt(userId, delta, {
      description: reason || 'Admin USDT wallet adjustment',
      createdBy,
      metadata: { adjustment: true },
    });
  }

  return debitUsdt(userId, Math.abs(delta), {
    description: reason || 'Admin USDT wallet adjustment',
    createdBy,
    metadata: { adjustment: true },
  });
}

async function adjustMmk(userId, deltaMmk, reason, createdBy = 'admin') {
  const delta = parseFloat(deltaMmk);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Adjustment amount must be a non-zero number');
  }

  if (delta > 0) {
    return creditMmk(userId, delta, {
      description: reason || 'Admin MMK wallet adjustment',
      createdBy,
      metadata: { adjustment: true },
    });
  }

  return debitMmk(userId, Math.abs(delta), {
    description: reason || 'Admin MMK wallet adjustment',
    createdBy,
    metadata: { adjustment: true },
  });
}

function walletPayload(user) {
  const mmk = Number(user.balance_mmk ?? 0);
  const usdtAvailable = Number(user.balance_usdt ?? 0);
  const usdtLocked = Number(user.balance_usdt_locked ?? 0);
  const usdtTotal = Math.round((usdtAvailable + usdtLocked) * 100) / 100;
  return {
    balance_mmk: mmk,
    balance_usdt: usdtAvailable,
    balance_usdt_locked: usdtLocked,
    balance_usdt_total: usdtTotal,
    currency_primary: 'MMK',
    mmk_formatted: formatMmk(mmk),
    usdt_formatted: formatUsdt(usdtAvailable),
    usdt_locked_formatted: formatUsdt(usdtLocked),
    usdt_total_formatted: formatUsdt(usdtTotal),
  };
}

module.exports = {
  formatMmk,
  formatUsdt,
  MMK_WALLET_ALLOWED_DEBIT_PURPOSES,
  assertMmkDebitAllowed,
  getMmkBalance,
  getUsdtBalance,
  creditMmk,
  debitMmk,
  creditUsdt,
  debitUsdt,
  adjustMmk,
  adjustUsdt,
  migrateLegacyUsdToMmk,
  migrateAllLegacyUsdBalances,
  walletPayload,
};
