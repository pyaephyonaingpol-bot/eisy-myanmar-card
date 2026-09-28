/**
 * Bitnob user-account ledger — strictly separate from Master Wallet (balance_usdt).
 *
 * Credits come from Bitnob deposit-address receipts (or admin adjustment).
 * Debits fund Standard Card (Bitnob) issuance / reload only.
 */

const crypto = require('crypto');
const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');

function roundUsdt(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatBitnobUsdt(amount) {
  return `$ ${roundUsdt(amount).toFixed(2)} USDT`;
}

function generateJournalId(prefix = 'BNW') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function getBitnobUsdtBalance(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return roundUsdt(user.balance_bitnob_usdt ?? 0);
}

async function creditBitnobUsdt(userId, amountUsdt, opts = {}) {
  const amount = roundUsdt(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Bitnob credit amount must be a positive number');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const journalId = String(opts.journalId || generateJournalId('BNW_CR')).trim();
  const description = opts.description || `Bitnob wallet credit — ${formatBitnobUsdt(amount)}`;
  const metadata = {
    ledger: 'bitnob',
    wallet: 'bitnob_usdt',
    ...(opts.metadata || {}),
  };

  const updated = await runInTransaction(async (db) => {
    const existing = await db.get(
      'SELECT id FROM bitnob_wallet_ledger WHERE journal_id = ?',
      journalId
    );
    if (existing) {
      return User.findById(userId);
    }

    const user = await db.get('SELECT id, balance_bitnob_usdt FROM users WHERE id = ?', userId);
    if (!user) throw new Error('User not found');

    const before = roundUsdt(user.balance_bitnob_usdt ?? 0);
    const after = roundUsdt(before + amount);

    await db.run(
      `UPDATE users SET balance_bitnob_usdt = ?, updated_at = datetime('now') WHERE id = ?`,
      after,
      userId
    );

    await db.run(
      `INSERT INTO bitnob_wallet_ledger (
        user_id, direction, amount_usdt, balance_after, journal_id,
        purpose, description, reference_type, reference_id, metadata, created_by
      ) VALUES (?, 'credit', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      amount,
      after,
      journalId,
      opts.purpose || 'bitnob_deposit',
      description,
      opts.referenceType || null,
      opts.referenceId != null ? String(opts.referenceId) : null,
      JSON.stringify(metadata),
      opts.createdBy || 'system'
    );

    return { id: userId, balance_bitnob_usdt: after, _before: before };
  });

  try {
    await TransactionLog.create({
      userId,
      type: 'wallet_credit',
      direction: 'in',
      amountUsd: amount,
      referenceType: opts.referenceType || 'bitnob_wallet_ledger',
      referenceId: opts.referenceId || null,
      description,
      createdBy: opts.createdBy || 'system',
      metadata: { ...metadata, journal_id: journalId },
    });
  } catch (logErr) {
    console.warn('[bitnobWalletLedger] TransactionLog credit failed:', logErr.message);
  }

  return updated;
}

async function debitBitnobUsdt(userId, amountUsdt, opts = {}) {
  const amount = roundUsdt(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Bitnob debit amount must be a positive number');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const journalId = String(opts.journalId || generateJournalId('BNW_DB')).trim();
  const description = opts.description || `Bitnob wallet debit — ${formatBitnobUsdt(amount)}`;
  const metadata = {
    ledger: 'bitnob',
    wallet: 'bitnob_usdt',
    ...(opts.metadata || {}),
  };

  const updated = await runInTransaction(async (db) => {
    const existing = await db.get(
      'SELECT id FROM bitnob_wallet_ledger WHERE journal_id = ?',
      journalId
    );
    if (existing) {
      return User.findById(userId);
    }

    const user = await db.get('SELECT id, balance_bitnob_usdt FROM users WHERE id = ?', userId);
    if (!user) throw new Error('User not found');

    const before = roundUsdt(user.balance_bitnob_usdt ?? 0);
    if (before + 1e-9 < amount) {
      const err = new Error(
        `Insufficient Standard Card wallet balance. Need ${formatBitnobUsdt(amount)}, `
        + `available ${formatBitnobUsdt(before)}. Deposit USDT to your Standard Card address first.`
      );
      err.code = 'INSUFFICIENT_BITNOB_BALANCE';
      err.required_usdt = amount;
      err.available_usdt = before;
      throw err;
    }

    const after = roundUsdt(before - amount);

    await db.run(
      `UPDATE users SET balance_bitnob_usdt = ?, updated_at = datetime('now') WHERE id = ?`,
      after,
      userId
    );

    await db.run(
      `INSERT INTO bitnob_wallet_ledger (
        user_id, direction, amount_usdt, balance_after, journal_id,
        purpose, description, reference_type, reference_id, metadata, created_by
      ) VALUES (?, 'debit', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      amount,
      after,
      journalId,
      opts.purpose || 'bitnob_card',
      description,
      opts.referenceType || null,
      opts.referenceId != null ? String(opts.referenceId) : null,
      JSON.stringify(metadata),
      opts.createdBy || 'user'
    );

    return { id: userId, balance_bitnob_usdt: after, _before: before };
  });

  try {
    await TransactionLog.create({
      userId,
      type: 'wallet_debit',
      direction: 'out',
      amountUsd: amount,
      referenceType: opts.referenceType || 'bitnob_wallet_ledger',
      referenceId: opts.referenceId || null,
      description,
      createdBy: opts.createdBy || 'user',
      metadata: { ...metadata, journal_id: journalId },
    });
  } catch (logErr) {
    console.warn('[bitnobWalletLedger] TransactionLog debit failed:', logErr.message);
  }

  return updated;
}

module.exports = {
  roundUsdt,
  formatBitnobUsdt,
  generateJournalId,
  getBitnobUsdtBalance,
  creditBitnobUsdt,
  debitBitnobUsdt,
};
