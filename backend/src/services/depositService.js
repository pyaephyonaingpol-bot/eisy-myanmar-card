const { getDb } = require('../db');
const crypto = require('crypto');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const CardReloadRequest = require('../models/CardReloadRequest');
const TransactionLog = require('../models/TransactionLog');
const { notifyAdminDepositVerified } = require('./telegram');
const { getCardPricingSettings, buildRateSnapshot, parseRecordMetadata, calculateDepositFeeBreakdown } = require('./settingsService');
const { applyCardTransaction } = require('./cardBalanceService');
const { formatMmk, formatUsdt } = require('./walletService');
const { syncUserWalletById, syncDeposit } = require('./supabaseSyncService');
const { verifyUsdtTransaction } = require('./usdtBlockchainService');
const { assertValidPaymentAmount } = require('./paymentFeeService');
const { creditPlatformUsdtRevenue, PLATFORM_FEE_TYPES } = require('./platformRevenueService');

async function syncWalletAndDeposit(userId, depositRow) {
  try {
    if (userId) await syncUserWalletById(userId);
  } catch (err) {
    console.warn('[deposit] wallet sync failed:', err.message);
  }
  try {
    if (depositRow) await syncDeposit(depositRow);
  } catch (err) {
    console.warn('[deposit] deposit re-sync failed:', err.message);
  }
}

/**
 * On-chain USDT verification bypass — OFF by default.
 * Only enable with BYPASS_USDT_TX_VERIFICATION=true for local testing.
 * Hard-blocked in production (NODE_ENV=production).
 */
function isUsdtVerificationBypassEnabled() {
  const requested = String(process.env.BYPASS_USDT_TX_VERIFICATION || '').toLowerCase() === 'true';
  if (!requested) return false;
  if (process.env.NODE_ENV === 'production') {
    console.error('[deposit] Refusing BYPASS_USDT_TX_VERIFICATION in production');
    return false;
  }
  console.warn('[deposit] BYPASS_USDT_TX_VERIFICATION enabled — insecure, local/dev only');
  return true;
}

function generateRefCode() {
  // 8 hex chars (~4B space) — harder to guess than 4 digits for listener attacks
  return `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
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
  } while (attempts < 20);
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
  const amountMmk = Math.round(parseFloat(amount_mmk) || 0);
  if (!(amountMmk > 0)) {
    throw new Error('Positive amount_mmk is required');
  }

  const computedUsd = amount_usd != null ? amount_usd : amountMmk / rate;
  const rateSnapshot = await buildRateSnapshot();

  const mergedMetadata = {
    ...(metadata || {}),
    rate_snapshot: rateSnapshot,
  };

  // Wallet top-ups apply unified payment service fee: max(2%, min $1 MMK-equivalent)
  if (purpose === 'topup') {
    const feeBreakdown = calculateDepositFeeBreakdown(amountMmk, { currency: 'MMK', settings });
    assertValidPaymentAmount(feeBreakdown, { kind: 'MMK deposit' });
    mergedMetadata.payment_fee = {
      operation: 'deposit',
      currency: 'MMK',
      gross_mmk: feeBreakdown.amount_mmk,
      fee_mmk: feeBreakdown.fee_mmk,
      net_mmk: feeBreakdown.net_mmk,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_mmk: feeBreakdown.minimum_fee_mmk,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_rule: feeBreakdown.fee_rule,
      fee_label: feeBreakdown.fee_label,
    };
    mergedMetadata.pricing = {
      ...(mergedMetadata.pricing || {}),
      ...mergedMetadata.payment_fee,
      is_wallet_topup: true,
      mmk_to_usd_rate: rate,
    };
  }

  const deposit = await DepositRequest.create({
    userId,
    amountMmk,
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
    amountMmk,
    amountUsd: computedUsd,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[${purpose}] Deposit requested: ${refCode} via ${deposit.payment_method}`,
    createdBy: 'user',
    metadata: {
      purpose,
      payment_method: deposit.payment_method,
      rate_snapshot: rateSnapshot,
      payment_fee: mergedMetadata.payment_fee || null,
      ...(metadata || {}),
    },
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

  const feeBreakdown = calculateDepositFeeBreakdown(amount, { currency: 'USDT', settings });
  assertValidPaymentAmount(feeBreakdown, { kind: 'USDT deposit' });

  const net = String(network || 'TRC20').toUpperCase();
  if (!['TRC20', 'BEP20'].includes(net)) {
    throw new Error('network must be TRC20 or BEP20');
  }

  const depositAddress = net === 'BEP20'
    ? settings.usdt_bep20_address
    : (() => {
      try {
        const { getMasterWalletAddress } = require('./tronMasterWalletService');
        return getMasterWalletAddress();
      } catch (_) {
        return settings.usdt_trc20_address;
      }
    })();

  if (!depositAddress) {
    throw new Error('USDT deposit address is not configured');
  }

  const refCode = await uniqueRefCode();
  const grossAmount = feeBreakdown.amount_usdt;
  const mergedMetadata = {
    ...(metadata || {}),
    deposit_currency: 'USDT',
    usdt_network: net,
    deposit_address: depositAddress,
    amount_usdt: grossAmount,
    gross_usdt: grossAmount,
    fee_usdt: feeBreakdown.fee_usdt,
    net_usdt: feeBreakdown.net_usdt,
    deposit_channel: metadata?.deposit_channel || 'platform_direct',
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      gross_usdt: feeBreakdown.amount_usdt,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_rule: feeBreakdown.fee_rule,
      fee_label: feeBreakdown.fee_label,
    },
    pricing: {
      amount_usdt: grossAmount,
      fee_usdt: feeBreakdown.fee_usdt,
      net_usdt: feeBreakdown.net_usdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_label: feeBreakdown.fee_label,
      is_usdt_topup: true,
    },
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: grossAmount,
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
    amountUsd: grossAmount,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[usdt_topup] USDT deposit requested: ${refCode} via ${net} (fee ${formatUsdt(feeBreakdown.fee_usdt)}, net ${formatUsdt(feeBreakdown.net_usdt)})`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      network: net,
      deposit_address: depositAddress,
      payment_fee: mergedMetadata.payment_fee,
    },
  });

  return { deposit, depositAddress, network: net, fee_breakdown: feeBreakdown };
}

async function findVerifiedDepositByTxHash(txHash) {
  const db = getDb();
  const hash = String(txHash || '').trim();
  if (!hash) return null;
  return db.get(`
    SELECT * FROM deposit_requests_v2
    WHERE status = 'VERIFIED'
      AND (tx_hash = ? OR txn_id = ? OR kpay_transaction_id = ?)
    LIMIT 1
  `, hash, hash, hash);
}

async function assertTxHashAvailable(txHash, depositId) {
  const hash = String(txHash || '').trim();
  if (!hash) return;
  const existing = await findVerifiedDepositByTxHash(hash);
  if (existing && Number(existing.id) !== Number(depositId)) {
    const err = new Error('This TxHash / transaction ID has already been used for a verified deposit');
    err.code = 'TX_HASH_REUSED';
    throw err;
  }
}

/**
 * Claim deposit for credit inside an open transaction. If another worker already
 * credited it, return { alreadyVerified: true }. On other terminal states, throw.
 */
async function claimDepositOrThrow(deposit, {
  txnId,
  reviewedByAdminId,
  adminNote,
}) {
  const claimed = await DepositRequest.claimForCredit(deposit.id, {
    adminNote,
    reviewedByAdminId,
    txnId,
    txHash: txnId,
  });
  if (claimed) return { claimed: true };

  const fresh = await DepositRequest.findById(deposit.id);
  if (fresh?.status === 'VERIFIED') {
    return { claimed: false, alreadyVerified: true, deposit: fresh };
  }
  const err = new Error(`Deposit cannot be credited in status: ${fresh?.status || 'unknown'}`);
  err.code = 'DEPOSIT_NOT_CREDITABLE';
  throw err;
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

  await assertTxHashAvailable(hash, depositId);

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

  if (isUsdtVerificationBypassEnabled()) {
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

  if (!expectedAddress) {
    const updated = await DepositRequest.findById(depositId);
    return {
      autoVerified: false,
      pending: true,
      deposit: updated,
      verification: { status: 'error', message: 'Platform deposit address not configured' },
      message: 'Deposit address not configured — contact support.',
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

  // Re-check reuse after chain confirm (TOCTOU window)
  await assertTxHashAvailable(hash, depositId);

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
    message: `USDT deposit verified — ${formatUsdt(creditResult.net_usdt || expectedAmount)} credited to your wallet (after service fee)!`,
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

  const creditTxnId = txnId || deposit.tx_hash || deposit.txn_id || deposit.kpay_transaction_id || null;
  await assertTxHashAvailable(creditTxnId, deposit.id);

  const purpose = deposit.purpose || parseRecordMetadata(deposit.metadata).purpose || 'topup';
  const metadata = parseRecordMetadata(deposit.metadata);

  if (purpose === 'card_issuance') {
    const dbTxn = getDb();
    await dbTxn.run('BEGIN');
    try {
      const claim = await claimDepositOrThrow(deposit, {
        txnId: creditTxnId,
        reviewedByAdminId,
        adminNote: adminNote || 'Card issuance deposit verified',
      });
      if (!claim.claimed) {
        await dbTxn.run('ROLLBACK');
        const freshUser = await User.findById(deposit.user_id);
        return { deposit: claim.deposit, user: freshUser, alreadyVerified: true };
      }
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
      metadata: { txn_id: creditTxnId, admin_note: adminNote, purpose: 'card_issuance', wallet_credit_skipped: true },
    });

    notifyAdminDepositVerified({
      user,
      deposit: updatedDeposit,
      txnId: creditTxnId || deposit.kpay_transaction_id,
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

    await syncWalletAndDeposit(deposit.user_id, updatedDeposit);

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

    const dbReload = getDb();
    await dbReload.run('BEGIN');
    try {
      const claim = await claimDepositOrThrow(deposit, {
        txnId: creditTxnId,
        reviewedByAdminId,
        adminNote,
      });
      if (!claim.claimed) {
        await dbReload.run('ROLLBACK');
        const freshUser = await User.findById(deposit.user_id);
        return { deposit: claim.deposit, user: freshUser, alreadyVerified: true };
      }
      await dbReload.run('COMMIT');
    } catch (err) {
      await dbReload.run('ROLLBACK');
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
      description: `Card reload verified: ${deposit.ref_code} — $${Number(netUsd).toFixed(2)} added to card`,
      createdBy,
      metadata: { txn_id: creditTxnId, admin_note: adminNote, purpose: 'card_reload', card_id: cardId },
    });

    notifyAdminDepositVerified({
      user: updatedUser,
      deposit: updatedDeposit,
      txnId: creditTxnId || deposit.kpay_transaction_id,
      senderPhone: updatedUser?.phone,
    });

    const linkedReload = await CardReloadRequest.findPendingByDepositId(deposit.id);
    if (linkedReload) {
      await CardReloadRequest.updateStatus(linkedReload.id, 'approved', {
        adminNote: adminNote || 'Approved via deposit review',
        reviewedBy: createdBy,
      });
    }

    await syncWalletAndDeposit(deposit.user_id, updatedDeposit);

    return {
      deposit: updatedDeposit,
      user: updatedUser,
      card: cardResult.card,
      alreadyVerified: false,
      card_reload: true,
    };
  }

  if (purpose === 'usdt_topup') {
    const grossUsdt = Number(deposit.amount_usd ?? metadata.amount_usdt ?? 0);
    const feeMeta = metadata.payment_fee || metadata.pricing || {};
    let feeUsdt = Number(feeMeta.fee_usdt);
    let netUsdt = Number(feeMeta.net_usdt);

    if (!Number.isFinite(feeUsdt) || !Number.isFinite(netUsdt) || feeUsdt < 0 || netUsdt <= 0) {
      const settings = await getCardPricingSettings();
      const feeBreakdown = calculateDepositFeeBreakdown(grossUsdt, { currency: 'USDT', settings });
      feeUsdt = feeBreakdown.fee_usdt;
      netUsdt = feeBreakdown.net_usdt;
    }

    netUsdt = Math.round(netUsdt * 100) / 100;
    feeUsdt = Math.round(feeUsdt * 100) / 100;
    if (!(netUsdt > 0)) {
      throw new Error('USDT deposit net credit must be positive after service fee');
    }

    const balanceBeforeUsdt = Number(user.balance_usdt ?? 0);

    await db.run('BEGIN');
    try {
      const claim = await claimDepositOrThrow(deposit, {
        txnId: creditTxnId,
        reviewedByAdminId,
        adminNote,
      });
      if (!claim.claimed) {
        await db.run('ROLLBACK');
        const freshUser = await User.findById(deposit.user_id);
        return { deposit: claim.deposit, user: freshUser, alreadyVerified: true };
      }

      await db.run(`
        UPDATE users SET balance_usdt = COALESCE(balance_usdt, 0) + ?, updated_at = datetime('now') WHERE id = ?
      `, netUsdt, deposit.user_id);

      await db.run(`
        UPDATE deposit_requests SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
        WHERE ref_code = ? AND status != 'VERIFIED'
      `, creditTxnId, deposit.ref_code).catch(() => {});

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
      amountUsd: netUsdt,
      balanceBefore: balanceBeforeUsdt,
      balanceAfter: balanceAfterUsdt,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `USDT deposit verified: ${deposit.ref_code} — gross ${formatUsdt(grossUsdt)}, fee ${formatUsdt(feeUsdt)}, credited ${formatUsdt(netUsdt)}`,
      createdBy,
      metadata: {
        txn_id: creditTxnId,
        admin_note: adminNote,
        purpose: 'usdt_topup',
        wallet: 'usdt',
        gross_usdt: grossUsdt,
        fee_usdt: feeUsdt,
        net_usdt: netUsdt,
      },
    });

    await TransactionLog.create({
      userId: deposit.user_id,
      type: 'balance_credit',
      direction: 'credit',
      amountUsd: netUsdt,
      balanceBefore: balanceBeforeUsdt,
      balanceAfter: balanceAfterUsdt,
      referenceType: 'deposit_requests_v2',
      referenceId: deposit.id,
      description: `USDT wallet top-up +${formatUsdt(netUsdt)} (after ${formatUsdt(feeUsdt)} service fee)`,
      createdBy,
      metadata: {
        wallet: 'usdt',
        deposit_ref: deposit.ref_code,
        network: deposit.usdt_network || metadata.usdt_network || null,
        txn_id: creditTxnId,
        gross_usdt: grossUsdt,
        fee_usdt: feeUsdt,
        net_usdt: netUsdt,
      },
    });

    if (feeUsdt > 0) {
      try {
        await creditPlatformUsdtRevenue(feeUsdt, {
          feeType: PLATFORM_FEE_TYPES.DEPOSIT,
          description: `USDT deposit fee — ${deposit.ref_code} (${formatUsdt(feeUsdt)})`,
          referenceType: 'deposit_requests_v2',
          referenceId: deposit.id,
          relatedUserId: deposit.user_id,
          metadata: {
            purpose: 'usdt_topup',
            gross_usdt: grossUsdt,
            net_usdt: netUsdt,
            fee_rule: feeMeta.fee_rule || 'Math.max(amount * 0.02, 1)',
          },
        });
      } catch (feeErr) {
        console.warn('[deposit] platform deposit fee credit failed:', feeErr.message);
      }
    }

    try {
      const { recordWalletEntry } = require('./usdtWalletService');
      await recordWalletEntry({
        userId: deposit.user_id,
        txType: 'deposit_verified',
        direction: 'credit',
        amountUsdt: netUsdt,
        balanceAfter: balanceAfterUsdt,
        network: deposit.usdt_network || metadata.usdt_network || null,
        txHash: creditTxnId || null,
        counterpartyAddress: metadata.deposit_address || null,
        referenceType: 'deposit_requests_v2',
        referenceId: deposit.id,
        description: `USDT deposit verified: ${deposit.ref_code} — ${formatUsdt(netUsdt)} credited after fee`,
        metadata: {
          wallet: 'usdt',
          deposit_ref: deposit.ref_code,
          purpose: 'usdt_topup',
          gross_usdt: grossUsdt,
          fee_usdt: feeUsdt,
          net_usdt: netUsdt,
        },
      });
    } catch (ledgerErr) {
      console.warn('[deposit] USDT ledger record failed:', ledgerErr.message);
    }

    notifyAdminDepositVerified({
      user: updatedUser,
      deposit: updatedDeposit,
      txnId: creditTxnId || deposit.kpay_transaction_id,
      senderPhone: user.phone,
    });

    await syncWalletAndDeposit(deposit.user_id, updatedDeposit);

    return {
      deposit: updatedDeposit,
      user: updatedUser,
      alreadyVerified: false,
      usdt_topup: true,
      fee_usdt: feeUsdt,
      net_usdt: netUsdt,
      gross_usdt: grossUsdt,
    };
  }

  const grossMmk = Number(deposit.amount_mmk) || 0;
  const feeMetaMmk = metadata.payment_fee || metadata.pricing || {};
  let feeMmk = Number(feeMetaMmk.fee_mmk);
  let netMmk = Number(feeMetaMmk.net_mmk);
  const isWalletTopup = purpose === 'topup';

  if (isWalletTopup) {
    if (!Number.isFinite(feeMmk) || !Number.isFinite(netMmk) || feeMmk < 0 || netMmk <= 0) {
      const settings = await getCardPricingSettings();
      const feeBreakdown = calculateDepositFeeBreakdown(grossMmk, { currency: 'MMK', settings });
      feeMmk = feeBreakdown.fee_mmk;
      netMmk = feeBreakdown.net_mmk;
    }
    feeMmk = Math.round(feeMmk);
    netMmk = Math.round(netMmk);
    if (!(netMmk > 0)) {
      throw new Error('MMK deposit net credit must be positive after service fee');
    }
  } else {
    feeMmk = 0;
    netMmk = grossMmk;
  }

  const balanceBeforeMmk = Number(user.balance_mmk ?? 0);

  await db.run('BEGIN');
  try {
    const claim = await claimDepositOrThrow(deposit, {
      txnId: creditTxnId,
      reviewedByAdminId,
      adminNote,
    });
    if (!claim.claimed) {
      await db.run('ROLLBACK');
      const freshUser = await User.findById(deposit.user_id);
      return { deposit: claim.deposit, user: freshUser, alreadyVerified: true };
    }

    await db.run(`
      UPDATE users SET balance_mmk = COALESCE(balance_mmk, 0) + ?, updated_at = datetime('now') WHERE id = ?
    `, netMmk, deposit.user_id);

    await db.run(`
      UPDATE deposit_requests SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
      WHERE ref_code = ? AND status != 'VERIFIED'
    `, creditTxnId, deposit.ref_code).catch(() => {});

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
    amountMmk: netMmk,
    amountUsd: deposit.amount_usd,
    balanceBefore: balanceBeforeMmk,
    balanceAfter: balanceAfterMmk,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: isWalletTopup
      ? `Deposit verified: ${deposit.ref_code} — gross ${formatMmk(grossMmk)}, fee ${formatMmk(feeMmk)}, credited ${formatMmk(netMmk)}`
      : `Deposit verified: ${deposit.ref_code} — MMK wallet credited ${formatMmk(netMmk)}`,
    createdBy,
    metadata: {
      txn_id: creditTxnId,
      admin_note: adminNote,
      purpose: deposit.purpose,
      wallet: 'mmk',
      gross_mmk: grossMmk,
      fee_mmk: feeMmk,
      net_mmk: netMmk,
    },
  });

  await TransactionLog.create({
    userId: deposit.user_id,
    type: 'balance_credit',
    direction: 'credit',
    amountMmk: netMmk,
    balanceBefore: balanceBeforeMmk,
    balanceAfter: balanceAfterMmk,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: isWalletTopup
      ? `MMK wallet top-up +${formatMmk(netMmk)} (after ${formatMmk(feeMmk)} service fee)`
      : `MMK wallet credit +${formatMmk(netMmk)}`,
    createdBy,
    metadata: {
      wallet: 'mmk',
      deposit_ref: deposit.ref_code,
      txn_id: creditTxnId,
      gross_mmk: grossMmk,
      fee_mmk: feeMmk,
      net_mmk: netMmk,
    },
  });

  notifyAdminDepositVerified({
    user: updatedUser,
    deposit: updatedDeposit,
    txnId: creditTxnId || deposit.kpay_transaction_id,
    senderPhone: user.phone,
  });

  await syncWalletAndDeposit(deposit.user_id, updatedDeposit);

  return {
    deposit: updatedDeposit,
    user: updatedUser,
    alreadyVerified: false,
    fee_mmk: feeMmk,
    net_mmk: netMmk,
    gross_mmk: grossMmk,
  };
}

async function verifyByListener({ ref_code, amount, txn_id, sender_phone }) {
  const deposit = await DepositRequest.findByRefCode(ref_code);

  if (!deposit) {
    const db = getDb();
    const legacy = await db.get(`
      SELECT dr.*, u.name, u.phone, u.balance, u.balance_mmk
      FROM deposit_requests dr JOIN users u ON u.id = dr.user_id
      WHERE dr.ref_code = ?
    `, ref_code);
    if (!legacy) throw new Error('Deposit request not found');

    if (String(legacy.status || '').toUpperCase() === 'VERIFIED') {
      const updatedUser = await User.findById(legacy.user_id);
      return { deposit: legacy, user: updatedUser, alreadyVerified: true };
    }

    const parsedAmount = parseFloat(amount);
    const expected = Number(legacy.amount_mmk);
    if (!Number.isFinite(parsedAmount) || Math.round(parsedAmount) !== Math.round(expected)) {
      throw new Error('Amount mismatch');
    }

    if (txn_id) {
      await assertTxHashAvailable(txn_id, legacy.id);
    }

    const balanceBeforeMmk = Number(legacy.balance_mmk ?? 0);
    await db.run('BEGIN');
    try {
      const claim = await db.run(
        `UPDATE deposit_requests SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
         WHERE id = ? AND status != 'VERIFIED'`,
        txn_id || null,
        legacy.id
      );
      if (Number(claim?.changes || 0) !== 1) {
        await db.run('ROLLBACK');
        const updatedUser = await User.findById(legacy.user_id);
        return { deposit: legacy, user: updatedUser, alreadyVerified: true };
      }
      await db.run(
        `UPDATE users SET balance_mmk = COALESCE(balance_mmk, 0) + ?, updated_at = datetime('now') WHERE id = ?`,
        expected,
        legacy.user_id
      );
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
      amountMmk: expected,
      amountUsd: legacy.amount_usd,
      balanceBefore: balanceBeforeMmk,
      balanceAfter: Number(updatedUser.balance_mmk ?? 0),
      referenceType: 'deposit_request',
      referenceId: legacy.id,
      description: `Auto-verified via listener: ${ref_code}`,
      createdBy: 'listener',
      metadata: { wallet: 'mmk', txn_id: txn_id || null },
    });
    return { deposit: legacy, user: updatedUser };
  }

  if (deposit.status === 'VERIFIED') {
    const user = await User.findById(deposit.user_id);
    return { deposit, user, alreadyVerified: true };
  }

  if (['REJECTED', 'FAILED'].includes(deposit.status)) {
    throw new Error(`Deposit cannot be verified in status: ${deposit.status}`);
  }

  if (deposit.purpose === 'usdt_topup' || deposit.deposit_currency === 'USDT') {
    throw new Error('USDT deposits cannot be verified via MMK listener');
  }

  const parsedAmount = parseFloat(amount);
  const expected = Number(deposit.amount_mmk);
  if (!Number.isFinite(parsedAmount) || Math.round(parsedAmount) !== Math.round(expected)) {
    throw new Error('Amount mismatch');
  }

  if (txn_id) {
    await assertTxHashAvailable(txn_id, deposit.id);
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
  findVerifiedDepositByTxHash,
  assertTxHashAvailable,
  isUsdtVerificationBypassEnabled,
  uniqueRefCode,
};
