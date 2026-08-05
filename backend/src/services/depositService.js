const { getDb } = require('../db');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const CardReloadRequest = require('../models/CardReloadRequest');
const TransactionLog = require('../models/TransactionLog');
const { notifyAdminDepositVerified } = require('./telegram');
const { getCardPricingSettings, buildRateSnapshot, parseRecordMetadata } = require('./settingsService');
const { applyCardTransaction } = require('./cardBalanceService');
const { formatMmk, formatUsdt } = require('./walletService');
const { verifyUsdtTransaction } = require('./usdtBlockchainService');

/** TEMPORARY: skip on-chain verification and auto-approve any USDT TxHash (testing). Set false before production. */
const BYPASS_USDT_TX_VERIFICATION = true;

function generateRefCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `REF-${num}`;
}

async function uniqueRefCode() {
  const db = getDb();
  let refCode;
  let attempts = 0;
  do {
    refCode = generateRefCode();
    const inV2 = await db.get('SELECT id FROM deposit_requests_v2 WHERE ref_code = ?', refCode);
    const inLegacy = await db.get('SELECT id FROM deposit_requests WHERE ref_code = ?', refCode);
    if (!inV2 && !inLegacy) break;
    attempts++;
  } while (attempts < 10);
  return refCode;
}

async function getExchangeRate() {
  const settings = await getCardPricingSettings();
  return settings.mmk_to_usd_rate;
}

async function createDepositRequest(userId, {
  amount_mmk,
  payment_method,
  purpose = 'topup',
  metadata,
  amount_usd,
}) {
  const refCode = await uniqueRefCode();
  const settings = await getCardPricingSettings();
  const rate = settings.mmk_to_usd_rate;
  const computedUsd = amount_usd != null ? amount_usd : amount_mmk / rate;
  const rateSnapshot = await buildRateSnapshot();

  const mergedMetadata = {
    ...(metadata || {}),
    rate_snapshot: rateSnapshot,
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: amount_mmk,
    amountUsd: computedUsd,
    refCode,
    paymentMethod: payment_method || 'KBZPay',
    purpose,
    metadata: mergedMetadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountMmk: amount_mmk,
    amountUsd: computedUsd,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[${purpose}] Deposit requested: ${refCode} via ${deposit.payment_method}`,
    createdBy: 'user',
    metadata: { purpose, payment_method: deposit.payment_method, rate_snapshot: rateSnapshot, ...(metadata || {}) },
  });

  return deposit;
}

async function createUsdtDepositRequest(userId, {
  amount_usdt,
  network = 'TRC20',
  metadata,
}) {
  const amount = parseFloat(amount_usdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Positive amount_usdt is required');
  }

  const settings = await getCardPricingSettings();
  const minUsdt = settings.minimum_usdt_deposit ?? 5;
  if (amount < minUsdt) {
    throw new Error(`Minimum USDT deposit is $${minUsdt.toFixed(2)} USDT`);
  }

  const net = String(network || 'TRC20').toUpperCase();
  if (!['TRC20', 'BEP20'].includes(net)) {
    throw new Error('network must be TRC20 or BEP20');
  }

  const depositAddress = net === 'BEP20'
    ? settings.usdt_bep20_address
    : settings.usdt_trc20_address;

  const refCode = await uniqueRefCode();
  const mergedMetadata = {
    ...(metadata || {}),
    deposit_currency: 'USDT',
    usdt_network: net,
    deposit_address: depositAddress,
    amount_usdt: Math.round(amount * 100) / 100,
    deposit_channel: metadata?.deposit_channel || 'platform_direct',
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: Math.round(amount * 100) / 100,
    refCode,
    paymentMethod: `USDT-${net}`,
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: net,
    metadata: mergedMetadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: amount,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] USDT deposit requested: ${refCode} via ${net}`,
    createdBy: 'user',
    metadata: { purpose: 'usdt_topup', network: net, deposit_address: depositAddress },
  });

  return { deposit, depositAddress, network: net };
}

async function findVerifiedDepositByTxHash(txHash) {
  const db = getDb();
  const hash = String(txHash).trim();
  if (!hash) return null;
  return db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE status = 'VERIFIED'
      AND (tx_hash = ? OR txn_id = ? OR kpay_transaction_id = ?)
    LIMIT 1
  `, hash, hash, hash);
}

async function submitAndAutoVerifyUsdtDeposit(depositId, {
  txHash,
  userNote,
  userId,
}) {
  const deposit = await DepositRequest.findById(depositId);
  if (!deposit) throw new Error('Deposit not found');
  if (deposit.user_id !== userId) throw new Error('Access denied');
  if (deposit.purpose !== 'usdt_topup' && deposit.deposit_currency !== 'USDT') {
    throw new Error('Not a USDT deposit request');
  }
  if (['VERIFIED', 'REJECTED', 'FAILED'].includes(deposit.status)) {
    throw new Error(`Cannot submit proof for status: ${deposit.status}`);
  }

  const hash = String(txHash).trim();
  if (!hash) {
    throw new Error('TxHash is required');
  }

  if (!BYPASS_USDT_TX_VERIFICATION) {
    const existing = await findVerifiedDepositByTxHash(hash);
    if (existing && existing.id !== depositId) {
      throw new Error('This TxHash has already been used for a verified deposit');
    }
  }

  if (deposit.status === 'VERIFIED') {
    const user = await User.findById(userId);
    return {
      autoVerified: true,
      alreadyVerified: true,
      deposit,
      user,
      message: 'USDT Deposit Approved Successfully!',
    };
  }

  await DepositRequest.submitProof(depositId, {
    kpayTransactionId: hash,
    txnId: hash,
    txHash: hash,
    userNote,
  });

  const metadata = parseRecordMetadata(deposit.metadata);
  const network = deposit.usdt_network || metadata.usdt_network || 'TRC20';
  const expectedAddress = metadata.deposit_address;
  const expectedAmount = Number(deposit.amount_usd ?? metadata.amount_usdt ?? 0);

  if (BYPASS_USDT_TX_VERIFICATION) {
    console.warn('[deposit] TEMP: bypassing USDT blockchain verification — auto-approving deposit');
    const refreshed = await DepositRequest.findById(depositId);
    const creditResult = await creditDepositAndVerify(refreshed, {
      txnId: hash,
      createdBy: 'test-bypass',
      adminNote: `Test bypass auto-approved (${network}) — TxHash: ${hash}`,
    });

    return {
      autoVerified: true,
      pending: false,
      deposit: creditResult.deposit,
      user: creditResult.user,
      verification: { ok: true, status: 'bypass', bypass: true },
      message: 'USDT Deposit Approved Successfully!',
      balance_usdt: Number(creditResult.user?.balance_usdt ?? 0),
    };
  }

  let verification;
  try {
    verification = await verifyUsdtTransaction({
      network,
      txHash: hash,
      expectedAddress,
      expectedAmountUsdt: expectedAmount,
    });
  } catch (err) {
    console.error('[deposit] USDT blockchain verify error:', err.message);
    const updated = await DepositRequest.findById(depositId);
    return {
      autoVerified: false,
      pending: true,
      deposit: updated,
      verification: { status: 'error', message: err.message },
      message: 'Transaction pending on blockchain or invalid TxHash.',
    };
  }

  if (!verification.ok) {
    const updated = await DepositRequest.findById(depositId);
    const isPending = verification.status === 'pending';
    return {
      autoVerified: false,
      pending: isPending,
      deposit: updated,
      verification,
      message: verification.message || 'Transaction pending on blockchain or invalid TxHash.',
    };
  }

  const refreshed = await DepositRequest.findById(depositId);
  const creditResult = await creditDepositAndVerify(refreshed, {
    txnId: hash,
    createdBy: 'blockchain',
    adminNote: `Auto-verified on-chain (${network}) — ${formatUsdt(verification.amountUsdt)}`,
  });

  return {
    autoVerified: true,
    pending: false,
    deposit: creditResult.deposit,
    user: creditResult.user,
    verification,
    message: `USDT deposit verified — ${formatUsdt(expectedAmount)} credited to your wallet instantly!`,
    balance_usdt: Number(creditResult.user?.balance_usdt ?? 0),
  };
}

async function creditDepositAndVerify(deposit, { txnId, reviewedByAdminId, createdBy = 'admin', adminNote }) {
  const db = getDb();
  const user = await User.findById(deposit.user_id);
  if (!user) throw new Error('User not found');

  if (deposit.status === 'VERIFIED') {
    return { deposit, user, alreadyVerified: true };
  }

  const purpose = deposit.purpose || parseRecordMetadata(deposit.metadata).purpose || 'topup';
  const metadata = parseRecordMetadata(deposit.metadata);

  if (purpose === 'card_issuance') {
    const dbTxn = getDb();
    await dbTxn.run('BEGIN');
    try {
      await DepositRequest.review(deposit.id, {
        status: 'VERIFIED',
        adminNote: adminNote || 'Card issuance deposit verified',
        reviewedByAdminId,
      });
      await dbTxn.run('COMMIT');
    } catch (err) {
      await dbTxn.run('ROLLBACK');
      throw err;
    }

    const updatedDeposit = await DepositRequest.findById(deposit.id);

    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'deposit_verified',
      direction: 'neutral',
      amountMmk: deposit.amount_mmk,
      amountUsd: deposit.amount_usd,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `Card issuance deposit verified: ${deposit.ref_code} (awaiting card activation)`,
      createdBy,
      metadata: { txn_id: txnId, admin_note: adminNote, purpose: 'card_issuance', wallet_credit_skipped: true },
    });

    notifyAdminDepositVerified({
      user,
      deposit: updatedDeposit,
      txnId: txnId || deposit.kpay_transaction_id,
      senderPhone: user?.phone,
    });

    console.log('[deposit] card_issuance verified without wallet credit:', deposit.ref_code);

    let activatedCard = null;
    const cardRequestId = metadata.card_request_id || metadata.pricing?.card_request_id;
    if (cardRequestId) {
      try {
        const { approvePendingCardRequest } = require('./cardApprovalService');
        const approval = await approvePendingCardRequest(parseInt(cardRequestId, 10), {
          adminNotes: adminNote || 'Auto-activated after card issuance deposit verification',
          skipDepositVerify: true,
          reviewedByAdminId,
          createdBy,
        });
        activatedCard = approval.card;
        console.log('[deposit] Auto-activated card', cardRequestId, 'status=', approval.card?.status);
      } catch (activateErr) {
        console.error('[deposit] Card auto-activation failed:', activateErr.message);
      }
    }

    return {
      deposit: updatedDeposit,
      user,
      alreadyVerified: false,
      card_issuance: true,
      card: activatedCard,
    };
  }

  if (purpose === 'card_reload') {
    const cardId = metadata.card_id || metadata.pricing?.card_id;
    const netUsd = metadata.pricing?.net_usd_to_card ?? deposit.amount_usd;
    if (!cardId) throw new Error('Card reload deposit missing card_id in metadata');

    const db = getDb();
    await db.run('BEGIN');
    try {
      await DepositRequest.review(deposit.id, {
        status: 'VERIFIED',
        adminNote,
        reviewedByAdminId,
      });
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    const cardResult = await applyCardTransaction(cardId, {
      action: 'topup',
      amount_usd: netUsd,
      note: `Reload approved — ${deposit.ref_code}`,
      createdBy,
    });

    const updatedUser = await User.findById(deposit.user_id);
    const updatedDeposit = await DepositRequest.findById(deposit.id);

    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'deposit_verified',
      direction: 'credit',
      amountMmk: deposit.amount_mmk,
      amountUsd: netUsd,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `Card reload verified: ${deposit.ref_code} — $${netUsd.toFixed(2)} added to card`,
      createdBy,
      metadata: { txn_id: txnId, admin_note: adminNote, purpose: 'card_reload', card_id: cardId },
    });

    notifyAdminDepositVerified({
      user: updatedUser,
      deposit: updatedDeposit,
      txnId: txnId || deposit.kpay_transaction_id,
      senderPhone: updatedUser?.phone,
    });

    const linkedReload = await CardReloadRequest.findPendingByDepositId(deposit.id);
    if (linkedReload) {
      await CardReloadRequest.updateStatus(linkedReload.id, 'approved', {
        adminNote: adminNote || 'Approved via deposit review',
        reviewedBy: createdBy,
      });
    }

    return {
      deposit: updatedDeposit,
      user: updatedUser,
      card: cardResult.card,
      alreadyVerified: false,
      card_reload: true,
    };
  }

  if (purpose === 'usdt_topup') {
    const amountUsdt = Number(deposit.amount_usd ?? metadata.amount_usdt ?? 0);
    const balanceBeforeUsdt = Number(user.balance_usdt ?? 0);

    await db.run('BEGIN');
    try {
      await DepositRequest.review(deposit.id, {
        status: 'VERIFIED',
        adminNote,
        reviewedByAdminId,
      });

      await db.run(`
        UPDATE users SET balance_usdt = COALESCE(balance_usdt, 0) + ?, updated_at = datetime('now') WHERE id = ?
      `, amountUsdt, deposit.user_id);

      await db.run(`
        UPDATE deposit_requests SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
        WHERE ref_code = ?
      `, txnId || deposit.kpay_transaction_id || deposit.txn_id, deposit.ref_code).catch(() => {});

      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    const updatedUser = await User.findById(deposit.user_id);
    const updatedDeposit = await DepositRequest.findById(deposit.id);
    const balanceAfterUsdt = Number(updatedUser.balance_usdt ?? 0);

    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'deposit_verified',
      direction: 'credit',
      amountUsd: amountUsdt,
      balanceBefore: balanceBeforeUsdt,
      balanceAfter: balanceAfterUsdt,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `USDT deposit verified: ${deposit.ref_code} — ${formatUsdt(amountUsdt)} credited`,
      createdBy,
      metadata: { txn_id: txnId, admin_note: adminNote, purpose: 'usdt_topup', wallet: 'usdt' },
    });

    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'balance_credit',
      direction: 'credit',
      amountUsd: amountUsdt,
      balanceBefore: balanceBeforeUsdt,
      balanceAfter: balanceAfterUsdt,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `USDT wallet top-up +${formatUsdt(amountUsdt)}`,
      createdBy,
      metadata: { wallet: 'usdt', deposit_ref: deposit.ref_code },
    });

    notifyAdminDepositVerified({
      user: updatedUser,
      deposit: updatedDeposit,
      txnId: txnId || deposit.kpay_transaction_id,
      senderPhone: user.phone,
    });

    return { deposit: updatedDeposit, user: updatedUser, alreadyVerified: false, usdt_topup: true };
  }

  const balanceBeforeMmk = Number(user.balance_mmk ?? 0);

  await db.run('BEGIN');
  try {
    await DepositRequest.review(deposit.id, {
      status: 'VERIFIED',
      adminNote,
      reviewedByAdminId,
    });

    await db.run(`
      UPDATE users SET balance_mmk = COALESCE(balance_mmk, 0) + ?, updated_at = datetime('now') WHERE id = ?
    `, deposit.amount_mmk, deposit.user_id);

    await db.run(`
      UPDATE deposit_requests SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
      WHERE ref_code = ?
    `, txnId || deposit.kpay_transaction_id || deposit.txn_id, deposit.ref_code).catch(() => {});

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  const updatedUser = await User.findById(deposit.user_id);
  const updatedDeposit = await DepositRequest.findById(deposit.id);
  const balanceAfterMmk = Number(updatedUser.balance_mmk ?? 0);

  await TransactionLog.create({
    userId: deposit.user_id,
    type: 'deposit_verified',
    direction: 'credit',
    amountMmk: deposit.amount_mmk,
    amountUsd: deposit.amount_usd,
    balanceBefore: balanceBeforeMmk,
    balanceAfter: balanceAfterMmk,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `Deposit verified: ${deposit.ref_code} — MMK wallet credited ${formatMmk(deposit.amount_mmk)}`,
    createdBy,
    metadata: { txn_id: txnId, admin_note: adminNote, purpose: deposit.purpose, wallet: 'mmk' },
  });

  await TransactionLog.create({
    userId: deposit.user_id,
    type: 'balance_credit',
    direction: 'credit',
    amountMmk: deposit.amount_mmk,
    balanceBefore: balanceBeforeMmk,
    balanceAfter: balanceAfterMmk,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `MMK wallet top-up +${formatMmk(deposit.amount_mmk)}`,
    createdBy,
    metadata: { wallet: 'mmk', deposit_ref: deposit.ref_code },
  });

  notifyAdminDepositVerified({
    user: updatedUser,
    deposit: updatedDeposit,
    txnId: txnId || deposit.kpay_transaction_id,
    senderPhone: user.phone,
  });

  return { deposit: updatedDeposit, user: updatedUser, alreadyVerified: false };
}

async function verifyByListener({ ref_code, amount, txn_id, sender_phone }) {
  let deposit = await DepositRequest.findByRefCode(ref_code);

  if (!deposit) {
    const db = getDb();
    const legacy = await db.get(`
      SELECT dr.*, u.name, u.phone, u.balance
      FROM deposit_requests dr JOIN users u ON u.id = dr.user_id
      WHERE dr.ref_code = ?
    `, ref_code);
    if (!legacy) throw new Error('Deposit request not found');

    const parsedAmount = parseFloat(amount);
    const tolerance = legacy.amount_mmk * 0.01;
    if (Math.abs(parsedAmount - legacy.amount_mmk) > tolerance) {
      throw new Error('Amount mismatch');
    }

    const balanceBeforeMmk = Number(legacy.balance_mmk ?? legacy.balance * 4500 ?? 0);
    await db.run('BEGIN');
    try {
      await db.run(`UPDATE deposit_requests SET status = 'VERIFIED', txn_id = ? WHERE id = ?`, txn_id, legacy.id);
      await db.run(`UPDATE users SET balance_mmk = COALESCE(balance_mmk, 0) + ?, updated_at = datetime('now') WHERE id = ?`, legacy.amount_mmk, legacy.user_id);
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }
    const updatedUser = await User.findById(legacy.user_id);
    await TransactionLog.create({
      userId: legacy.user_id,
      type: 'deposit_verified',
      direction: 'credit',
      amountMmk: legacy.amount_mmk,
      amountUsd: legacy.amount_usd,
      balanceBefore: balanceBeforeMmk,
      balanceAfter: Number(updatedUser.balance_mmk ?? 0),
      referenceType: 'deposit_request',
      referenceId: legacy.id,
      description: `Auto-verified via listener: ${ref_code}`,
      createdBy: 'listener',
      metadata: { wallet: 'mmk' },
    });
    return { deposit: legacy, user: updatedUser };
  }

  const parsedAmount = parseFloat(amount);
  const tolerance = deposit.amount_mmk * 0.01;
  if (Math.abs(parsedAmount - deposit.amount_mmk) > tolerance) {
    await DepositRequest.review(deposit.id, { status: 'FAILED', rejectionReason: 'Amount mismatch' });
    throw new Error('Amount mismatch');
  }

  return creditDepositAndVerify(deposit, {
    txnId: txn_id,
    createdBy: 'listener',
    adminNote: `Auto-verified. Sender: ${sender_phone || 'N/A'}`,
  });
}

module.exports = {
  getExchangeRate,
  createDepositRequest,
  createUsdtDepositRequest,
  submitAndAutoVerifyUsdtDeposit,
  creditDepositAndVerify,
  verifyByListener,
  uniqueRefCode,
};
