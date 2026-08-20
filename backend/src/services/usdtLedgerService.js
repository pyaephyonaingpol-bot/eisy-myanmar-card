const crypto = require('crypto');
const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');
const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const UsdtInternalTransfer = require('../models/UsdtInternalTransfer');
const { formatUsdt } = require('./walletService');
const { syncUserWalletById } = require('./supabaseSyncService');

function roundUsdt(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function generateJournalId(prefix = 'USDT') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function withDbTransaction(fn) {
  return runInTransaction(getDb(), fn);
}

async function fetchBalances(userId, db) {
  const row = await db.get(
    'SELECT id, balance_usdt, balance_usdt_locked FROM users WHERE id = ?',
    userId
  );
  if (!row) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  const available = roundUsdt(row.balance_usdt ?? 0);
  const locked = roundUsdt(row.balance_usdt_locked ?? 0);
  return { userId, available, locked, total: roundUsdt(available + locked) };
}

async function updateUserBalances(db, userId, available, locked) {
  await db.run(
    `UPDATE users SET balance_usdt = ?, balance_usdt_locked = ?, updated_at = datetime('now') WHERE id = ?`,
    roundUsdt(available),
    roundUsdt(locked),
    userId
  );
}

async function insertLedgerEntry(db, {
  userId,
  txType,
  direction = 'neutral',
  amountUsdt = 0,
  balanceBefore = null,
  balanceAfter = null,
  lockedBalanceAfter = null,
  network = null,
  txHash = null,
  counterpartyAddress = null,
  counterpartyUserId = null,
  status = 'completed',
  referenceType = null,
  referenceId = null,
  description = null,
  metadata = null,
  journalId = null,
}) {
  await db.run(`
    INSERT INTO usdt_wallet_transactions (
      user_id, network, tx_type, direction, amount_usdt,
      balance_before, balance_after, locked_balance_after,
      tx_hash, counterparty_address, counterparty_user_id,
      status, reference_type, reference_id, description, metadata, journal_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    userId,
    network,
    txType,
    direction,
    roundUsdt(amountUsdt),
    balanceBefore != null ? roundUsdt(balanceBefore) : null,
    balanceAfter != null ? roundUsdt(balanceAfter) : null,
    lockedBalanceAfter != null ? roundUsdt(lockedBalanceAfter) : null,
    txHash,
    counterpartyAddress,
    counterpartyUserId,
    status,
    referenceType,
    referenceId,
    description,
    metadata ? JSON.stringify(metadata) : null,
    journalId
  );
}

async function creditPlatformUsdtInTx(db, amountUsdt, {
  feeType,
  description,
  referenceType,
  referenceId,
  relatedUserId,
  metadata,
  createdBy = 'system',
}) {
  const amount = roundUsdt(amountUsdt);
  if (amount <= 0) return null;

  const existing = referenceType && referenceId != null
    ? await db.get(
      'SELECT id FROM platform_fee_events WHERE reference_type = ? AND reference_id = ? LIMIT 1',
      referenceType,
      referenceId
    )
    : null;
  if (existing) return { duplicate: true };

  const settingRow = await db.get(
    "SELECT value FROM app_settings WHERE key = 'platform_usdt_revenue_balance'"
  );
  const current = roundUsdt(settingRow?.value ?? 0);
  const balanceAfter = roundUsdt(current + amount);

  await db.run(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('platform_usdt_revenue_balance', ?, datetime('now'))`,
    String(balanceAfter)
  );

  await db.run(`
    INSERT INTO platform_fee_events (
      fee_type, amount, currency, reference_type, reference_id,
      related_user_id, description, metadata, created_by, collected_at
    ) VALUES (?, ?, 'USDT', ?, ?, ?, ?, ?, ?, datetime('now'))
  `,
    feeType,
    amount,
    referenceType || null,
    referenceId ?? null,
    relatedUserId ?? null,
    description || `Platform USDT revenue +${formatUsdt(amount)}`,
    metadata ? JSON.stringify(metadata) : null,
    createdBy
  );

  return { balance_before: current, balance_after: balanceAfter };
}

function syncWallets(userIds) {
  for (const userId of userIds) {
    if (userId) {
      syncUserWalletById(userId).catch((err) => console.warn('[ledger] wallet sync:', err.message));
    }
  }
}

async function getUsdtBalances(userId) {
  const db = getDb();
  const bal = await fetchBalances(userId, db);
  return {
    available_usdt: bal.available,
    locked_usdt: bal.locked,
    total_usdt: bal.total,
    available_formatted: formatUsdt(bal.available),
    locked_formatted: formatUsdt(bal.locked),
    total_formatted: formatUsdt(bal.total),
  };
}

async function creditAvailable(userId, amountUsdt, {
  txType = 'balance_credit',
  description,
  referenceType,
  referenceId,
  createdBy = 'system',
  metadata,
  network = null,
  txHash = null,
  counterpartyAddress = null,
  counterpartyUserId = null,
  journalId,
} = {}) {
  const amount = roundUsdt(amountUsdt);
  if (amount <= 0) throw new Error('Credit amount must be a positive number');

  const user = await withDbTransaction(async (db) => {
    const bal = await fetchBalances(userId, db);
    const availableAfter = roundUsdt(bal.available + amount);
    await updateUserBalances(db, userId, availableAfter, bal.locked);

    const jid = journalId || generateJournalId('CR');

    await insertLedgerEntry(db, {
      userId,
      txType,
      direction: 'credit',
      amountUsdt: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      lockedBalanceAfter: bal.locked,
      network,
      txHash,
      counterpartyAddress,
      counterpartyUserId,
      referenceType,
      referenceId,
      description: description || `USDT wallet credited ${formatUsdt(amount)}`,
      metadata: { wallet: 'usdt', ledger: 'available', ...(metadata || {}) },
      journalId: jid,
    });

    await TransactionLog.create({
      userId,
      type: txType,
      direction: 'credit',
      amountUsd: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      referenceType,
      referenceId,
      description: description || `USDT wallet credited ${formatUsdt(amount)}`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        ledger: 'available',
        locked_usdt: bal.locked,
        ...(metadata || {}),
      },
    });

    return User.findById(userId);
  });

  syncWallets([userId]);
  return user;
}

async function debitAvailable(userId, amountUsdt, {
  txType = 'balance_debit',
  description,
  referenceType,
  referenceId,
  createdBy = 'system',
  metadata,
  allowInsufficient = false,
  network = null,
  txHash = null,
  counterpartyAddress = null,
  counterpartyUserId = null,
  journalId,
} = {}) {
  const amount = roundUsdt(amountUsdt);
  if (amount <= 0) throw new Error('Debit amount must be a positive number');

  const user = await withDbTransaction(async (db) => {
    const bal = await fetchBalances(userId, db);
    if (bal.available < amount - 0.001 && !allowInsufficient) {
      const err = new Error(
        `Insufficient available USDT. Required ${formatUsdt(amount)}, available ${formatUsdt(bal.available)}`
      );
      err.code = 'INSUFFICIENT_USDT_BALANCE';
      err.required_usdt = amount;
      err.available_usdt = bal.available;
      throw err;
    }

    const availableAfter = roundUsdt(bal.available - amount);
    await updateUserBalances(db, userId, availableAfter, bal.locked);

    const jid = journalId || generateJournalId('DB');

    await insertLedgerEntry(db, {
      userId,
      txType,
      direction: 'debit',
      amountUsdt: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      lockedBalanceAfter: bal.locked,
      network,
      txHash,
      counterpartyAddress,
      counterpartyUserId,
      referenceType,
      referenceId,
      description: description || `USDT wallet debited ${formatUsdt(amount)}`,
      metadata: { wallet: 'usdt', ledger: 'available', ...(metadata || {}) },
      journalId: jid,
    });

    await TransactionLog.create({
      userId,
      type: txType,
      direction: 'debit',
      amountUsd: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      referenceType,
      referenceId,
      description: description || `USDT wallet debited ${formatUsdt(amount)}`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        ledger: 'available',
        locked_usdt: bal.locked,
        ...(metadata || {}),
      },
    });

    return User.findById(userId);
  });

  syncWallets([userId]);
  return user;
}

async function lockUsdtForEscrow(userId, amountUsdt, {
  holdType,
  referenceType,
  referenceId,
  description,
  metadata,
  createdBy = 'system',
  journalId,
} = {}) {
  const amount = roundUsdt(amountUsdt);
  if (amount <= 0) throw new Error('Escrow lock amount must be positive');
  if (!holdType || !referenceType || referenceId == null) {
    throw new Error('Escrow hold requires holdType, referenceType, and referenceId');
  }

  const result = await withDbTransaction(async (db) => {
    const existing = await db.get(
      `SELECT id FROM usdt_escrow_holds
       WHERE reference_type = ? AND reference_id = ? AND hold_type = ? AND status = 'active'`,
      referenceType,
      referenceId,
      holdType
    );
    if (existing) {
      const err = new Error('An active escrow hold already exists for this reference');
      err.code = 'ESCROW_HOLD_EXISTS';
      throw err;
    }

    const bal = await fetchBalances(userId, db);
    if (bal.available < amount - 0.001) {
      const err = new Error(
        `Insufficient available USDT for escrow. Required ${formatUsdt(amount)}, available ${formatUsdt(bal.available)}`
      );
      err.code = 'INSUFFICIENT_USDT_BALANCE';
      err.required_usdt = amount;
      err.available_usdt = bal.available;
      throw err;
    }

    const availableAfter = roundUsdt(bal.available - amount);
    const lockedAfter = roundUsdt(bal.locked + amount);
    await updateUserBalances(db, userId, availableAfter, lockedAfter);

    const jid = journalId || generateJournalId('LOCK');
    const holdResult = await db.run(`
      INSERT INTO usdt_escrow_holds (
        user_id, amount_usdt, remaining_usdt, hold_type,
        reference_type, reference_id, status, journal_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `,
      userId,
      amount,
      amount,
      holdType,
      referenceType,
      referenceId,
      jid,
      metadata ? JSON.stringify(metadata) : null
    );

    await insertLedgerEntry(db, {
      userId,
      txType: 'escrow_lock',
      direction: 'neutral',
      amountUsdt: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      lockedBalanceAfter: lockedAfter,
      referenceType,
      referenceId,
      description: description || `USDT locked in escrow — ${formatUsdt(amount)}`,
      metadata: {
        wallet: 'usdt',
        hold_type: holdType,
        escrow: true,
        ...(metadata || {}),
      },
      journalId: jid,
    });

    await TransactionLog.create({
      userId,
      type: 'escrow_lock',
      direction: 'neutral',
      amountUsd: amount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      referenceType,
      referenceId,
      description: description || `USDT escrow lock — ${formatUsdt(amount)}`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        hold_type: holdType,
        locked_usdt_after: lockedAfter,
        escrow: true,
        ...(metadata || {}),
      },
    });

    return {
      holdId: holdResult.lastID,
      journalId: jid,
      available_usdt: availableAfter,
      locked_usdt: lockedAfter,
    };
  });

  syncWallets([userId]);
  return result;
}

async function refundEscrowHold({
  userId,
  referenceType,
  referenceId,
  holdType,
  amountUsdt = null,
  description,
  createdBy = 'system',
  metadata,
} = {}) {
  const result = await withDbTransaction(async (db) => {
    const hold = await db.get(
      `SELECT * FROM usdt_escrow_holds
       WHERE user_id = ? AND reference_type = ? AND reference_id = ? AND hold_type = ? AND status = 'active'`,
      userId,
      referenceType,
      referenceId,
      holdType
    );
    if (!hold) {
      const err = new Error('Active escrow hold not found');
      err.code = 'ESCROW_HOLD_NOT_FOUND';
      throw err;
    }

    const refundAmount = roundUsdt(amountUsdt != null ? amountUsdt : hold.remaining_usdt);
    if (refundAmount <= 0) throw new Error('Nothing to refund from escrow hold');

    const remaining = roundUsdt(Number(hold.remaining_usdt) - refundAmount);
    if (remaining < -0.001) throw new Error('Refund exceeds escrow hold balance');

    const holdStatus = remaining <= 0.001 ? 'refunded' : 'active';
    await db.run(`
      UPDATE usdt_escrow_holds
      SET remaining_usdt = ?, status = ?, released_at = datetime('now')
      WHERE id = ?
    `, Math.max(0, remaining), holdStatus, hold.id);

    const bal = await fetchBalances(userId, db);
    const availableAfter = roundUsdt(bal.available + refundAmount);
    const lockedAfter = roundUsdt(bal.locked - refundAmount);
    if (lockedAfter < -0.001) throw new Error('Locked balance underflow during escrow refund');

    await updateUserBalances(db, userId, availableAfter, lockedAfter);

    const jid = generateJournalId('REFUND');

    await insertLedgerEntry(db, {
      userId,
      txType: 'escrow_refund',
      direction: 'credit',
      amountUsdt: refundAmount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      lockedBalanceAfter: lockedAfter,
      referenceType,
      referenceId,
      description: description || `Escrow refunded — ${formatUsdt(refundAmount)}`,
      metadata: { wallet: 'usdt', hold_type: holdType, escrow_refund: true, ...(metadata || {}) },
      journalId: jid,
    });

    await TransactionLog.create({
      userId,
      type: 'escrow_refund',
      direction: 'credit',
      amountUsd: refundAmount,
      balanceBefore: bal.available,
      balanceAfter: availableAfter,
      referenceType,
      referenceId,
      description: description || `Escrow refund — ${formatUsdt(refundAmount)}`,
      createdBy,
      metadata: { wallet: 'usdt', hold_type: holdType, locked_usdt_after: lockedAfter, ...(metadata || {}) },
    });

    return { refundAmount, available_usdt: availableAfter, locked_usdt: lockedAfter, journalId: jid };
  });

  syncWallets([userId]);
  return result;
}

async function consumeEscrowToBuyer({
  fromUserId,
  toUserId,
  grossAmountUsdt,
  netToBuyerUsdt,
  platformFeeUsdt = 0,
  holdReference,
  description,
  buyerDescription,
  referenceType,
  referenceId,
  platformFeeType,
  platformMetadata,
  metadata,
  createdBy = 'system',
} = {}) {
  if (!holdReference?.referenceType || holdReference.referenceId == null || !holdReference.holdType) {
    throw new Error('Escrow release requires holdReference');
  }

  const gross = roundUsdt(grossAmountUsdt);
  const net = roundUsdt(netToBuyerUsdt);
  const fee = roundUsdt(platformFeeUsdt);
  if (gross <= 0 || net <= 0) throw new Error('Escrow release amounts must be positive');
  if (Math.abs(gross - net - fee) > 0.02) {
    throw new Error('Escrow gross amount must equal buyer net plus platform fee');
  }

  const result = await withDbTransaction(async (db) => {
    const hold = await db.get(
      `SELECT * FROM usdt_escrow_holds
       WHERE user_id = ? AND reference_type = ? AND reference_id = ? AND hold_type = ? AND status = 'active'`,
      fromUserId,
      holdReference.referenceType,
      holdReference.referenceId,
      holdReference.holdType
    );
    if (!hold) {
      const err = new Error('Active escrow hold not found for release');
      err.code = 'ESCROW_HOLD_NOT_FOUND';
      throw err;
    }
    if (Number(hold.remaining_usdt) < gross - 0.001) {
      throw new Error(`Insufficient escrow hold — need ${formatUsdt(gross)}, have ${formatUsdt(hold.remaining_usdt)}`);
    }

    const remaining = roundUsdt(Number(hold.remaining_usdt) - gross);
    const holdStatus = remaining <= 0.001 ? 'consumed' : 'active';
    await db.run(`
      UPDATE usdt_escrow_holds
      SET remaining_usdt = ?, status = ?, released_at = datetime('now')
      WHERE id = ?
    `, Math.max(0, remaining), holdStatus, hold.id);

    const sellerBal = await fetchBalances(fromUserId, db);
    const sellerLockedAfter = roundUsdt(sellerBal.locked - gross);
    if (sellerLockedAfter < -0.001) throw new Error('Seller locked balance underflow');
    await updateUserBalances(db, fromUserId, sellerBal.available, sellerLockedAfter);

    const buyerBal = await fetchBalances(toUserId, db);
    const buyerAvailableAfter = roundUsdt(buyerBal.available + net);
    await updateUserBalances(db, toUserId, buyerAvailableAfter, buyerBal.locked);

    const journalId = generateJournalId('P2P');

    await insertLedgerEntry(db, {
      userId: fromUserId,
      txType: 'escrow_release',
      direction: 'debit',
      amountUsdt: gross,
      balanceBefore: sellerBal.available,
      balanceAfter: sellerBal.available,
      lockedBalanceAfter: sellerLockedAfter,
      counterpartyUserId: toUserId,
      referenceType,
      referenceId,
      description: description || `Escrow released — ${formatUsdt(gross)} to counterparty`,
      metadata: {
        wallet: 'usdt',
        escrow_release: true,
        buyer_receives_usdt: net,
        platform_fee_usdt: fee,
        hold_type: holdReference.holdType,
        ...(metadata || {}),
      },
      journalId,
    });

    await insertLedgerEntry(db, {
      userId: toUserId,
      txType: 'escrow_receive',
      direction: 'credit',
      amountUsdt: net,
      balanceBefore: buyerBal.available,
      balanceAfter: buyerAvailableAfter,
      lockedBalanceAfter: buyerBal.locked,
      counterpartyUserId: fromUserId,
      referenceType,
      referenceId,
      description: buyerDescription || `Escrow received — ${formatUsdt(net)}`,
      metadata: {
        wallet: 'usdt',
        escrow_receive: true,
        from_user_id: fromUserId,
        ...(metadata || {}),
      },
      journalId,
    });

    await TransactionLog.create({
      userId: fromUserId,
      type: 'escrow_release',
      direction: 'debit',
      amountUsd: gross,
      balanceBefore: sellerBal.available,
      balanceAfter: sellerBal.available,
      referenceType,
      referenceId,
      description: description || `Escrow release — ${formatUsdt(gross)}`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        locked_usdt_after: sellerLockedAfter,
        buyer_user_id: toUserId,
        buyer_receives_usdt: net,
        platform_fee_usdt: fee,
        journal_id: journalId,
        ...(metadata || {}),
      },
    });

    await TransactionLog.create({
      userId: toUserId,
      type: 'escrow_receive',
      direction: 'credit',
      amountUsd: net,
      balanceBefore: buyerBal.available,
      balanceAfter: buyerAvailableAfter,
      referenceType,
      referenceId,
      description: buyerDescription || `Escrow received — ${formatUsdt(net)}`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        from_user_id: fromUserId,
        journal_id: journalId,
        ...(metadata || {}),
      },
    });

    if (fee > 0 && platformFeeType) {
      await creditPlatformUsdtInTx(db, fee, {
        feeType: platformFeeType,
        description: platformMetadata?.description || `Platform fee — ${formatUsdt(fee)}`,
        referenceType,
        referenceId,
        relatedUserId: fromUserId,
        metadata: platformMetadata,
        createdBy,
      });
    }

    return {
      journalId,
      seller: { userId: fromUserId, locked_usdt: sellerLockedAfter },
      buyer: { userId: toUserId, available_usdt: buyerAvailableAfter },
      platform_fee_usdt: fee,
    };
  });

  syncWallets([fromUserId, toUserId]);
  return result;
}

async function transferUsdtInternal(fromUserId, toUserId, amountUsdt, {
  idempotencyKey = null,
  note = null,
  feeUsdt = 0,
  createdBy = 'user',
} = {}) {
  if (fromUserId === toUserId) {
    throw new Error('Cannot transfer USDT to yourself');
  }

  const amount = roundUsdt(amountUsdt);
  const fee = roundUsdt(feeUsdt);
  const totalDebit = roundUsdt(amount + fee);
  if (amount <= 0) throw new Error('Transfer amount must be positive');

  const toUser = await User.findById(toUserId);
  if (!toUser) throw new Error('Recipient not found');

  if (idempotencyKey) {
    const existing = await UsdtInternalTransfer.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        duplicate: true,
        transfer: existing,
        journal_id: existing.journal_id,
      };
    }
  }

  const result = await withDbTransaction(async (db) => {
    const senderBal = await fetchBalances(fromUserId, db);
    if (senderBal.available < totalDebit - 0.001) {
      const err = new Error(
        `Insufficient available USDT. Required ${formatUsdt(totalDebit)}, available ${formatUsdt(senderBal.available)}`
      );
      err.code = 'INSUFFICIENT_USDT_BALANCE';
      throw err;
    }

    const senderAvailableAfter = roundUsdt(senderBal.available - totalDebit);
    await updateUserBalances(db, fromUserId, senderAvailableAfter, senderBal.locked);

    const receiverBal = await fetchBalances(toUserId, db);
    const receiverAvailableAfter = roundUsdt(receiverBal.available + amount);
    await updateUserBalances(db, toUserId, receiverAvailableAfter, receiverBal.locked);

    const journalId = generateJournalId('XFER');
    const transferResult = await db.run(`
      INSERT INTO usdt_internal_transfers (
        idempotency_key, from_user_id, to_user_id, amount_usdt, fee_usdt, status, note, journal_id
      ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)
    `, idempotencyKey, fromUserId, toUserId, amount, fee, note, journalId);

    const transferId = transferResult.lastID;

    await insertLedgerEntry(db, {
      userId: fromUserId,
      txType: 'internal_transfer_out',
      direction: 'debit',
      amountUsdt: totalDebit,
      balanceBefore: senderBal.available,
      balanceAfter: senderAvailableAfter,
      lockedBalanceAfter: senderBal.locked,
      counterpartyUserId: toUserId,
      referenceType: 'usdt_internal_transfers',
      referenceId: transferId,
      description: note || `Internal transfer sent — ${formatUsdt(amount)} to user #${toUserId}`,
      metadata: { wallet: 'usdt', transfer_amount: amount, fee_usdt: fee, note },
      journalId,
    });

    await insertLedgerEntry(db, {
      userId: toUserId,
      txType: 'internal_transfer_in',
      direction: 'credit',
      amountUsdt: amount,
      balanceBefore: receiverBal.available,
      balanceAfter: receiverAvailableAfter,
      lockedBalanceAfter: receiverBal.locked,
      counterpartyUserId: fromUserId,
      referenceType: 'usdt_internal_transfers',
      referenceId: transferId,
      description: note || `Internal transfer received — ${formatUsdt(amount)} from user #${fromUserId}`,
      metadata: { wallet: 'usdt', note },
      journalId,
    });

    await TransactionLog.create({
      userId: fromUserId,
      type: 'internal_transfer_out',
      direction: 'debit',
      amountUsd: totalDebit,
      balanceBefore: senderBal.available,
      balanceAfter: senderAvailableAfter,
      referenceType: 'usdt_internal_transfers',
      referenceId: transferId,
      description: `Sent ${formatUsdt(amount)} USDT to ${toUser.email || `user #${toUserId}`}`,
      createdBy,
      metadata: { wallet: 'usdt', to_user_id: toUserId, fee_usdt: fee, journal_id: journalId, note },
    });

    await TransactionLog.create({
      userId: toUserId,
      type: 'internal_transfer_in',
      direction: 'credit',
      amountUsd: amount,
      balanceBefore: receiverBal.available,
      balanceAfter: receiverAvailableAfter,
      referenceType: 'usdt_internal_transfers',
      referenceId: transferId,
      description: `Received ${formatUsdt(amount)} USDT from user #${fromUserId}`,
      createdBy,
      metadata: { wallet: 'usdt', from_user_id: fromUserId, journal_id: journalId, note },
    });

    if (fee > 0) {
      const { PLATFORM_FEE_TYPES } = require('../constants/platformFeeTypes');
      await creditPlatformUsdtInTx(db, fee, {
        feeType: PLATFORM_FEE_TYPES.P2P,
        description: `Internal transfer fee — ${formatUsdt(fee)}`,
        referenceType: 'usdt_internal_transfers',
        referenceId: transferId,
        relatedUserId: fromUserId,
        createdBy,
      });
    }

    const transfer = await db.get('SELECT * FROM usdt_internal_transfers WHERE id = ?', transferId);
    return { transfer, journalId };
  });

  syncWallets([fromUserId, toUserId]);
  return result;
}

module.exports = {
  roundUsdt,
  generateJournalId,
  runInTransaction: withDbTransaction,
  withDbTransaction,
  getUsdtBalances,
  creditAvailable,
  debitAvailable,
  lockUsdtForEscrow,
  refundEscrowHold,
  consumeEscrowToBuyer,
  transferUsdtInternal,
};
