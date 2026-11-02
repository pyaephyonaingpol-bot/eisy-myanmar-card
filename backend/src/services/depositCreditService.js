/**
 * Atomic USDT wallet credit for deposits.
 *
 * User proof submit, admin approval, and the blockchain deposit webhook all
 * reach creditDepositAndVerify(), which credits usdt_topup through
 * creditUsdtBalanceAtomic(). A deposit is claimed once (status → VERIFIED).
 * The wallet balance and the ledger row commit in the same SQL transaction.
 * A second call sees the claim and does not add the amount again.
 */

const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');

const OPEN_USDT_STATUSES = ['PENDING', 'AWAITING_SCREENSHOT', 'SUBMITTED', 'UNDER_REVIEW'];
const AMOUNT_MATCH_EPSILON = 0.02;
const LEDGER_ACTORS = new Set([
  'system',
  'user',
  'admin',
  'listener',
  'blockchain',
  'binance_pay',
  'test-bypass',
  'tron-indexer',
]);
const SOURCE_ACTORS = {
  user_submit: 'user',
  admin_approval: 'admin',
  blockchain_webhook: 'blockchain',
};

function ledgerActor(source, createdBy) {
  if (LEDGER_ACTORS.has(createdBy)) return createdBy;
  return SOURCE_ACTORS[source] || 'blockchain';
}

function roundUsdt(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Claim the deposit and add net USDT to the user's wallet in one transaction.
 * Already-verified deposits return the current balance and do not credit again.
 */
async function creditUsdtBalanceAtomic({
  deposit,
  netUsdt,
  txnId = null,
  reviewedByAdminId = null,
  adminNote = null,
  network = null,
  counterpartyAddress = null,
  description = null,
} = {}) {
  if (!deposit?.id || !deposit.user_id) {
    throw httpError('Deposit is required', 'DEPOSIT_REQUIRED', 400);
  }

  const amount = roundUsdt(netUsdt);
  if (!(amount > 0)) {
    throw httpError(
      'USDT deposit net credit must be positive after service fee',
      'INVALID_NET_USDT',
      400
    );
  }

  const db = getDb();
  return runInTransaction(db, async () => {
    const claimed = await DepositRequest.claimForCredit(deposit.id, {
      adminNote,
      reviewedByAdminId,
      txnId,
      txHash: txnId,
    });

    if (!claimed) {
      const fresh = await DepositRequest.findById(deposit.id);
      const user = await User.findById(deposit.user_id);
      if (fresh?.status === 'VERIFIED') {
        const balance = Number(user?.balance_usdt ?? 0);
        return {
          alreadyVerified: true,
          user,
          deposit: fresh,
          balanceBefore: balance,
          balanceAfter: balance,
          netUsdt: amount,
        };
      }
      throw httpError(
        `Deposit cannot be credited in status: ${fresh?.status || 'unknown'}`,
        'DEPOSIT_NOT_CREDITABLE',
        409
      );
    }

    const beforeRow = await db.get(
      'SELECT balance_usdt FROM users WHERE id = ?',
      deposit.user_id
    );
    const balanceBefore = Number(beforeRow?.balance_usdt ?? 0);

    const updated = await db.run(
      `UPDATE users
       SET balance_usdt = COALESCE(balance_usdt, 0) + ?, updated_at = datetime('now')
       WHERE id = ?`,
      amount,
      deposit.user_id
    );
    if (Number(updated?.changes || 0) !== 1) {
      throw httpError('User wallet was not updated', 'WALLET_UPDATE_FAILED', 500);
    }

    const legacy = await db.get(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deposit_requests'`
    );
    if (legacy) {
      await db.run(
        `UPDATE deposit_requests
         SET status = 'VERIFIED', txn_id = COALESCE(?, txn_id)
         WHERE ref_code = ? AND status != 'VERIFIED'`,
        txnId,
        deposit.ref_code
      );
    }

    const afterRow = await db.get(
      'SELECT balance_usdt FROM users WHERE id = ?',
      deposit.user_id
    );
    const balanceAfter = Number(afterRow?.balance_usdt ?? 0);

    const dup = await db.get(
      `SELECT id FROM usdt_wallet_transactions
       WHERE user_id = ? AND reference_type = ? AND reference_id = ? AND tx_type = ?
       LIMIT 1`,
      deposit.user_id,
      'deposit_requests_v2',
      deposit.id,
      'deposit_verified'
    );

    if (!dup) {
      await db.run(
        `INSERT INTO usdt_wallet_transactions (
          user_id, network, tx_type, direction, amount_usdt,
          balance_before, balance_after, tx_hash, counterparty_address,
          status, reference_type, reference_id, description, metadata
        ) VALUES (?, ?, 'deposit_verified', 'credit', ?, ?, ?, ?, ?, 'completed', 'deposit_requests_v2', ?, ?, ?)`,
        deposit.user_id,
        network || deposit.usdt_network || null,
        amount,
        balanceBefore,
        balanceAfter,
        txnId || null,
        counterpartyAddress || null,
        deposit.id,
        description || `USDT deposit verified: ${deposit.ref_code}`,
        JSON.stringify({
          wallet: 'usdt',
          deposit_ref: deposit.ref_code,
          purpose: 'usdt_topup',
          net_usdt: amount,
        })
      );
    }

    return {
      alreadyVerified: false,
      user: await User.findById(deposit.user_id),
      deposit: await DepositRequest.findById(deposit.id),
      balanceBefore,
      balanceAfter,
      netUsdt: amount,
    };
  });
}

async function findOpenUsdtTopup(userId, amountUsdt, network) {
  const db = getDb();
  const rows = await db.all(
    `SELECT * FROM deposit_requests_v2
     WHERE user_id = ?
       AND (purpose = 'usdt_topup' OR deposit_currency = 'USDT')
       AND status IN (${OPEN_USDT_STATUSES.map(() => '?').join(', ')})
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
    userId,
    ...OPEN_USDT_STATUSES
  );

  const net = String(network || 'TRC20').toUpperCase();
  const amount = Number(amountUsdt);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const candidates = rows.filter((row) => {
    const rowNet = String(row.usdt_network || net).toUpperCase();
    if (row.usdt_network && rowNet !== net) return false;
    if (!hasAmount) return true;
    return Math.abs(Number(row.amount_usd) - amount) <= AMOUNT_MATCH_EPSILON;
  });

  if (hasAmount) return candidates[0] || null;
  return candidates.length === 1 ? candidates[0] : null;
}

async function createIncomingUsdtDeposit({
  userId,
  amountUsdt,
  network,
  toAddress,
  source,
}) {
  const gross = roundUsdt(amountUsdt);
  if (!(gross > 0)) {
    throw httpError('amount_usdt must be positive', 'INVALID_AMOUNT', 400);
  }

  const { getCardPricingSettings, calculateDepositFeeBreakdown } = require('./settingsService');
  const settings = await getCardPricingSettings();
  const feeBreakdown = calculateDepositFeeBreakdown(gross, { currency: 'USDT', settings });
  const netUsdt = roundUsdt(feeBreakdown.net_usdt);
  const feeUsdt = roundUsdt(feeBreakdown.fee_usdt);
  if (!(netUsdt > 0)) {
    throw httpError(
      'USDT deposit net credit must be positive after service fee',
      'INVALID_NET_USDT',
      400
    );
  }

  const { uniqueRefCode } = require('./depositService');
  const refCode = await uniqueRefCode();
  const metadata = {
    deposit_currency: 'USDT',
    usdt_network: network,
    deposit_address: toAddress,
    deposit_address_source: 'custodial',
    deposit_channel: source || 'blockchain_webhook',
    amount_usdt: gross,
    gross_usdt: gross,
    fee_usdt: feeUsdt,
    net_usdt: netUsdt,
    payment_fee: {
      operation: 'deposit',
      currency: 'USDT',
      gross_usdt: gross,
      fee_usdt: feeUsdt,
      net_usdt: netUsdt,
      platform_profit_usd: feeUsdt,
      fee_percent: feeBreakdown.fee_percent,
      minimum_fee_usdt: feeBreakdown.minimum_fee_usdt,
      used_minimum_fee: feeBreakdown.used_minimum_fee,
      fee_rule: feeBreakdown.fee_rule,
      fee_label: feeBreakdown.fee_label,
    },
    pricing: {
      amount_usdt: gross,
      fee_usdt: feeUsdt,
      net_usdt: netUsdt,
      platform_profit_usd: feeUsdt,
      is_usdt_topup: true,
    },
  };

  return DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: gross,
    refCode,
    paymentMethod: `USDT-${network}`,
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: network,
    metadata,
    platformProfitUsd: feeUsdt,
  });
}

/**
 * Resolve a user deposit from an id, a tx hash, or a custodial TRC20 address,
 * verify the transfer, then credit that user's USDT wallet once.
 *
 * verifyTransfer is required for blockchain_webhook. The HTTP route always
 * passes the on-chain verifier and never honors a skip flag from the body.
 */
async function applyIncomingDepositCredit({
  source = 'blockchain_webhook',
  depositId = null,
  userId = null,
  txHash,
  toAddress = null,
  amountUsdt = null,
  network = 'TRC20',
  adminNote = null,
  reviewedByAdminId = null,
  verifyTransfer = null,
  createdBy = null,
} = {}) {
  const hash = String(txHash || '').trim();
  const net = String(network || 'TRC20').toUpperCase();
  const amount = Number(amountUsdt);
  const address = String(toAddress || '').trim();

  if (source === 'blockchain_webhook' && typeof verifyTransfer !== 'function') {
    throw httpError(
      'Blockchain deposit credit requires on-chain verification',
      'VERIFY_REQUIRED',
      400
    );
  }

  const {
    findVerifiedDepositByTxHash,
    findDepositByTxHash,
    creditDepositAndVerify,
    assertTxHashAvailable,
  } = require('./depositService');

  if (hash) {
    const verified = await findVerifiedDepositByTxHash(hash);
    if (verified) {
      const user = await User.findById(verified.user_id);
      return {
        credited: false,
        alreadyVerified: true,
        deposit: verified,
        user,
        balance_usdt: Number(user?.balance_usdt ?? 0),
        source,
      };
    }
  }

  let deposit = null;
  if (depositId) {
    deposit = await DepositRequest.findById(depositId);
    if (!deposit) throw httpError('Deposit not found', 'DEPOSIT_NOT_FOUND', 404);
    if (userId && Number(deposit.user_id) !== Number(userId)) {
      throw httpError('Deposit does not belong to this user', 'DEPOSIT_USER_MISMATCH', 403);
    }
    if (deposit.status === 'VERIFIED') {
      const user = await User.findById(deposit.user_id);
      return {
        credited: false,
        alreadyVerified: true,
        deposit,
        user,
        balance_usdt: Number(user?.balance_usdt ?? 0),
        source,
      };
    }
  } else if (hash) {
    const existing = await findDepositByTxHash(hash);
    if (existing && !['REJECTED', 'FAILED'].includes(existing.status)) {
      deposit = existing;
    }
  }

  let ownerId = deposit?.user_id || userId || null;
  if (!deposit && address) {
    const custodial = net === 'TRC20'
      ? await UserUsdtWalletAddress.findCustodialByAddress(address)
      : null;
    if (!custodial && !ownerId) {
      throw httpError(
        'No custodial wallet matches this deposit address',
        'DEPOSIT_ADDRESS_UNKNOWN',
        404
      );
    }
    if (custodial) {
      if (ownerId && Number(ownerId) !== Number(custodial.user_id)) {
        throw httpError(
          'Deposit address belongs to a different user',
          'DEPOSIT_USER_MISMATCH',
          403
        );
      }
      ownerId = custodial.user_id;
    }
    deposit = await findOpenUsdtTopup(ownerId, amount, net);
  }

  if (!deposit && !ownerId) {
    throw httpError('No deposit to credit', 'DEPOSIT_NOT_FOUND', 404);
  }

  const metadata = parseMetadata(deposit?.metadata);
  const storedAddress = String(metadata.deposit_address || '').trim();
  let expectedAddress = storedAddress || null;
  if (deposit && address && storedAddress && address !== storedAddress) {
    throw httpError(
      'Deposit address does not match this deposit',
      'DEPOSIT_ADDRESS_MISMATCH',
      400
    );
  }
  if (deposit && !storedAddress && address) {
    const custodial = net === 'TRC20'
      ? await UserUsdtWalletAddress.findCustodialByAddress(address)
      : null;
    if (!custodial || Number(custodial.user_id) !== Number(deposit.user_id)) {
      throw httpError(
        'Deposit address does not match this deposit',
        'DEPOSIT_ADDRESS_MISMATCH',
        400
      );
    }
    expectedAddress = address;
  }
  if (!deposit) expectedAddress = address || null;
  const expectedAmount = Number(deposit?.amount_usd ?? (Number.isFinite(amount) ? amount : NaN));

  let verification = null;
  if (typeof verifyTransfer === 'function') {
    if (!hash) throw httpError('tx_hash is required', 'MISSING_TX_HASH', 400);
    if (!expectedAddress) {
      throw httpError('Deposit address is required to verify the transfer', 'MISSING_DEPOSIT_ADDRESS', 400);
    }
    if (!(expectedAmount > 0)) {
      throw httpError('amount_usdt is required to verify the transfer', 'INVALID_AMOUNT', 400);
    }
    verification = await verifyTransfer({
      network: deposit?.usdt_network || net,
      txHash: hash,
      expectedAddress,
      expectedAmountUsdt: expectedAmount,
      deposit,
    });
    if (!verification || verification.ok !== true) {
      const err = httpError(
        verification?.message || 'On-chain verification failed',
        'ON_CHAIN_VERIFY_FAILED',
        400
      );
      err.verification = verification || null;
      throw err;
    }
  }

  if (!deposit) {
    if (!(Number.isFinite(amount) && amount > 0)) {
      throw httpError('amount_usdt is required', 'INVALID_AMOUNT', 400);
    }
    if (!address) {
      throw httpError('to_address is required', 'MISSING_DEPOSIT_ADDRESS', 400);
    }
    deposit = await createIncomingUsdtDeposit({
      userId: ownerId,
      amountUsdt: verification?.amountUsdt || amount,
      network: net,
      toAddress: address,
      source,
    });
  }

  if (deposit.purpose && deposit.purpose !== 'usdt_topup' && deposit.deposit_currency !== 'USDT') {
    throw httpError(
      'Only USDT top-up deposits credit the wallet balance',
      'NOT_USDT_TOPUP',
      400
    );
  }

  if (hash) await assertTxHashAvailable(hash, deposit.id);

  const credit = await creditDepositAndVerify(deposit, {
    txnId: hash || deposit.tx_hash || deposit.txn_id || null,
    reviewedByAdminId,
    createdBy: ledgerActor(source, createdBy),
    adminNote: adminNote || `USDT wallet credited via ${source}`,
  });

  return {
    credited: !credit.alreadyVerified,
    alreadyVerified: Boolean(credit.alreadyVerified),
    deposit: credit.deposit,
    user: credit.user,
    balance_usdt: Number(credit.user?.balance_usdt ?? 0),
    net_usdt: credit.net_usdt,
    fee_usdt: credit.fee_usdt,
    gross_usdt: credit.gross_usdt,
    source,
  };
}

module.exports = {
  creditUsdtBalanceAtomic,
  applyIncomingDepositCredit,
};
