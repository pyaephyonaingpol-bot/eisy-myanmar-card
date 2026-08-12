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

/**
 * MMK wallet debits are allowed for:
 * - virtual card issuance / reloads
 * - MMK bank withdrawals
 * MMK → USDT conversion is never allowed.
 */
const MMK_WALLET_ALLOWED_DEBIT_PURPOSES = new Set([
  'card_issuance',
  'card_reload',
  'mmk_bank_withdrawal',
]);

function assertMmkDebitAllowed({ createdBy, metadata } = {}) {
  if (createdBy === 'admin' || createdBy === 'system') return;
  if (metadata?.adjustment) return;
  const purpose = metadata?.purpose;
  if (purpose === 'mmk_to_usdt' || purpose === 'exchange_mmk_to_usdt' || purpose === 'convert_mmk_to_usdt') {
    const err = new Error(
      'MMK to USDT conversion is not allowed. '
      + 'Withdraw MMK to your bank account, or buy USDT via P2P with an external payment.'
    );
    err.code = 'MMK_TO_USDT_FORBIDDEN';
    throw err;
  }
  if (purpose && MMK_WALLET_ALLOWED_DEBIT_PURPOSES.has(purpose)) return;
  const err = new Error(
    'MMK wallet can only be used for virtual card issuance, card reloads, and bank withdrawals. '
    + 'MMK → USDT exchange is not available. P2P USDT trades use external KPay/WavePay/Bank transfers.'
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
  const { withDbTransaction } = require('../lib/libsqlDb');
  await withDbTransaction(db, async (tx) => {
    await tx.run(`
      UPDATE users
      SET balance_mmk = COALESCE(balance_mmk, 0) + ?,
          balance = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `, mmkAmount, userId);
  });

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
  return adminAdjustUsdtBalance({
    userId,
    deltaUsdt,
    reason,
    createdBy,
  });
}

/**
 * Reliable admin USDT balance adjustment for Turso/LibSQL.
 * Avoids fragile BEGIN/ROLLBACK across HTTP executes.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {number} [opts.deltaUsdt] - signed delta (+ credit / − debit)
 * @param {number} [opts.setBalance] - absolute target available balance
 * @param {string} [opts.reason]
 * @param {string} [opts.createdBy]
 */
async function adminAdjustUsdtBalance({
  userId,
  deltaUsdt = null,
  setBalance = null,
  reason = 'Admin USDT wallet adjustment',
  createdBy = 'admin',
} = {}) {
  const db = getDb();
  const uid = parseInt(userId, 10);
  console.log('[adjustUsdt] start', {
    userId: uid,
    deltaUsdt,
    setBalance,
    reason,
    createdBy,
  });

  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error('Valid user_id is required');
  }

  const row = await db.get(
    'SELECT id, balance_usdt, balance_usdt_locked FROM users WHERE id = ?',
    uid
  );
  if (!row) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const balanceBefore = Math.round((Number(row.balance_usdt) || 0) * 100) / 100;
  const locked = Math.round((Number(row.balance_usdt_locked) || 0) * 100) / 100;

  let balanceAfter;
  let delta;
  if (setBalance != null && setBalance !== '') {
    balanceAfter = Math.round((Number(setBalance) || 0) * 100) / 100;
    if (!Number.isFinite(balanceAfter) || balanceAfter < 0) {
      throw new Error('set_balance must be a number >= 0');
    }
    delta = Math.round((balanceAfter - balanceBefore) * 100) / 100;
  } else {
    delta = Math.round((Number(deltaUsdt) || 0) * 100) / 100;
    if (!Number.isFinite(delta) || delta === 0) {
      throw new Error('Adjustment amount must be a non-zero number (or pass set_balance)');
    }
    balanceAfter = Math.round((balanceBefore + delta) * 100) / 100;
    if (balanceAfter < -0.001) {
      const err = new Error(
        `Insufficient available USDT. Required ${formatUsdt(Math.abs(delta))}, available ${formatUsdt(balanceBefore)}`
      );
      err.code = 'INSUFFICIENT_USDT_BALANCE';
      throw err;
    }
    if (balanceAfter < 0) balanceAfter = 0;
  }

  console.log('[adjustUsdt] computed', {
    userId: uid,
    balanceBefore,
    delta,
    balanceAfter,
    locked,
  });

  if (delta === 0) {
    console.log('[adjustUsdt] no-op (already at target)');
    return {
      id: uid,
      balance_usdt: balanceBefore,
      balance_usdt_locked: locked,
      _adjust: { delta: 0, balance_before: balanceBefore, balance_after: balanceBefore },
    };
  }

  const direction = delta > 0 ? 'credit' : 'debit';
  const absAmount = Math.abs(delta);
  const journalId = `ADJ-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const description = reason || 'Admin USDT wallet adjustment';
  const meta = JSON.stringify({
    wallet: 'usdt',
    adjustment: true,
    delta,
    set_balance: setBalance != null,
    journal_id: journalId,
  });

  const statements = [
    {
      sql: `UPDATE users
            SET balance_usdt = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [balanceAfter, uid],
      label: 'update_users_balance',
    },
  ];

  // Critical path: update balance WITHOUT BEGIN/ROLLBACK (Turso-safe).
  try {
    console.log('[adjustUsdt] executing UPDATE users.balance_usdt', {
      userId: uid,
      balanceAfter,
    });
    let updateResult;
    try {
      updateResult = await db.run(statements[0].sql, ...statements[0].args);
    } catch (updateErr) {
      // Some environments may lack updated_at until auth patches run.
      if (/no such column:\s*updated_at/i.test(updateErr.message || '')) {
        console.warn('[adjustUsdt] retrying UPDATE without updated_at');
        updateResult = await db.run(
          `UPDATE users SET balance_usdt = ? WHERE id = ?`,
          balanceAfter,
          uid
        );
      } else {
        throw updateErr;
      }
    }
    console.log('[adjustUsdt] UPDATE result', {
      changes: updateResult?.changes,
      lastID: updateResult?.lastID,
    });
    if (!updateResult || Number(updateResult.changes) < 1) {
      const err = new Error(`USDT balance UPDATE affected 0 rows for user ${uid}`);
      err.code = 'BALANCE_UPDATE_FAILED';
      throw err;
    }
  } catch (err) {
    console.error('[adjustUsdt] SQL UPDATE failed', {
      message: err.message,
      code: err.code,
      userId: uid,
      balanceBefore,
      balanceAfter,
      delta,
    });
    throw err;
  }

  const verify = await db.get(
    'SELECT id, balance_usdt, balance_usdt_locked FROM users WHERE id = ?',
    uid
  );
  console.log('[adjustUsdt] verify after write', verify);

  if (Math.abs(Number(verify?.balance_usdt) - balanceAfter) > 0.001) {
    const err = new Error(
      `USDT balance update did not persist (expected ${balanceAfter}, got ${verify?.balance_usdt})`
    );
    err.code = 'BALANCE_UPDATE_FAILED';
    throw err;
  }

  // Best-effort audit rows — never undo the balance update if these fail.
  try {
    await db.run(
      `INSERT INTO usdt_wallet_transactions (
         user_id, network, tx_type, direction, amount_usdt,
         balance_before, balance_after, locked_balance_after,
         status, description, metadata, journal_id
       ) VALUES (?, NULL, 'admin_adjustment', ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      uid,
      direction,
      absAmount,
      balanceBefore,
      balanceAfter,
      locked,
      description,
      meta,
      journalId
    );
    console.log('[adjustUsdt] wallet ledger row inserted');
  } catch (ledgerErr) {
    console.warn('[adjustUsdt] wallet ledger insert skipped:', ledgerErr.message);
    try {
      await db.run(
        `INSERT INTO usdt_wallet_transactions (
           user_id, tx_type, direction, amount_usdt, balance_after, status, description, metadata
         ) VALUES (?, 'admin_adjustment', ?, ?, ?, 'completed', ?, ?)`,
        uid,
        direction,
        absAmount,
        balanceAfter,
        description,
        meta
      );
    } catch (fallbackErr) {
      console.warn('[adjustUsdt] wallet ledger fallback skipped:', fallbackErr.message);
    }
  }

  try {
    await db.run(
      `INSERT INTO transaction_logs (
         user_id, type, direction, amount_usd, amount_mmk,
         balance_before, balance_after, reference_type, reference_id,
         description, metadata, ip_address, created_by
       ) VALUES (?, 'admin_adjustment', ?, ?, NULL, ?, ?, NULL, NULL, ?, ?, NULL, ?)`,
      uid,
      direction,
      absAmount,
      balanceBefore,
      balanceAfter,
      description,
      meta,
      createdBy === 'admin' || createdBy === 'system' || createdBy === 'user' || createdBy === 'listener'
        ? createdBy
        : 'admin'
    );
    console.log('[adjustUsdt] transaction_logs row inserted');
  } catch (logErr) {
    console.warn('[adjustUsdt] transaction_logs insert skipped:', logErr.message);
  }

  try {
    const { syncUserWalletById } = require('./supabaseSyncService');
    await syncUserWalletById(uid);
  } catch (syncErr) {
    console.warn('[adjustUsdt] supabase sync skipped:', syncErr.message);
  }

  return {
    ...verify,
    _adjust: {
      delta,
      balance_before: balanceBefore,
      balance_after: Number(verify.balance_usdt),
      journal_id: journalId,
    },
  };
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
  adminAdjustUsdtBalance,
  migrateLegacyUsdToMmk,
  migrateAllLegacyUsdBalances,
  walletPayload,
};
