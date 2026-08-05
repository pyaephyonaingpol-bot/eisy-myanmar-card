const { getDb } = require('../db');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const P2PSeller = require('../models/P2PSeller');
const TransactionLog = require('../models/TransactionLog');
const { parseRecordMetadata } = require('./settingsService');
const { creditDepositAndVerify, uniqueRefCode } = require('./depositService');
const { verifyUsdtTransaction } = require('./usdtBlockchainService');
const { formatUsdt } = require('./walletService');
const { notifyAdminP2pDepositPending } = require('./telegram');

function isP2pDeposit(deposit) {
  const meta = parseRecordMetadata(deposit?.metadata);
  return meta.deposit_channel === 'p2p' || Boolean(meta.p2p_seller_id);
}

async function createP2pUsdtDepositRequest(userId, {
  amount_usdt,
  network,
  p2p_seller_id,
}) {
  const amount = parseFloat(amount_usdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Positive amount_usdt is required');
  }

  const sellerId = parseInt(p2p_seller_id, 10);
  if (!sellerId) throw new Error('p2p_seller_id is required for P2P deposits');

  const seller = await P2PSeller.findById(sellerId);
  if (!seller || seller.status !== 'active') {
    throw new Error('Selected P2P merchant is not available');
  }

  const net = String(network || seller.network).toUpperCase();
  if (seller.network !== net) {
    throw new Error(`Selected merchant only accepts ${seller.network} deposits`);
  }

  const minDep = Number(seller.min_deposit);
  const maxDep = Number(seller.max_deposit);
  if (amount < minDep) {
    throw new Error(`Minimum deposit for this merchant is $${minDep.toFixed(2)} USDT`);
  }
  if (amount > maxDep) {
    throw new Error(`Maximum deposit for this merchant is $${maxDep.toFixed(2)} USDT`);
  }

  const refCode = await uniqueRefCode();
  const roundedAmount = Math.round(amount * 100) / 100;
  const mergedMetadata = {
    deposit_currency: 'USDT',
    usdt_network: net,
    deposit_address: seller.wallet_address,
    amount_usdt: roundedAmount,
    deposit_channel: 'p2p',
    p2p_seller_id: seller.id,
    p2p_seller_name: seller.name,
    p2p_status: 'awaiting_payment',
    qr_code_url: seller.qr_code_url || null,
  };

  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: roundedAmount,
    refCode,
    paymentMethod: `USDT-P2P-${net}`,
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: net,
    metadata: mergedMetadata,
  });

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: roundedAmount,
    referenceType: 'deposit_requests_v2',
    referenceId: deposit.id,
    description: `[P2P usdt_topup] Deposit requested via ${seller.name} (${net}) — ${refCode}`,
    createdBy: 'user',
    metadata: {
      purpose: 'usdt_topup',
      deposit_channel: 'p2p',
      p2p_seller_id: seller.id,
      p2p_seller_name: seller.name,
    },
  });

  return {
    deposit,
    seller: P2PSeller.mapForClient(seller),
    depositAddress: seller.wallet_address,
    network: net,
  };
}

async function submitP2pUsdtDeposit(depositId, { txHash, userNote, userId }) {
  const deposit = await DepositRequest.findById(depositId);
  if (!deposit) throw new Error('Deposit not found');
  if (deposit.user_id !== userId) throw new Error('Access denied');
  if (!isP2pDeposit(deposit)) throw new Error('Not a P2P USDT deposit');
  if (['VERIFIED', 'REJECTED', 'FAILED'].includes(deposit.status)) {
    throw new Error(`Cannot submit proof for status: ${deposit.status}`);
  }

  const hash = String(txHash || '').trim();
  if (!hash) throw new Error('TxHash is required');

  const metadata = parseRecordMetadata(deposit.metadata);

  await DepositRequest.submitProof(depositId, {
    kpayTransactionId: hash,
    txnId: hash,
    txHash: hash,
    userNote,
  });

  const db = getDb();
  const updatedMeta = {
    ...metadata,
    p2p_status: 'pending_verification',
    p2p_tx_submitted_at: new Date().toISOString(),
  };

  await db.run(`
    UPDATE deposit_requests_v2
    SET status = 'UNDER_REVIEW',
        metadata = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, JSON.stringify(updatedMeta), depositId);

  const updated = await DepositRequest.findById(depositId);
  const user = await User.findById(userId);
  const seller = metadata.p2p_seller_id
    ? await P2PSeller.findById(metadata.p2p_seller_id)
    : null;

  await TransactionLog.create({
    userId,
    type: 'deposit_request',
    direction: 'neutral',
    amountUsd: deposit.amount_usd,
    referenceType: 'deposit_requests_v2',
    referenceId: depositId,
    description: `P2P USDT deposit TxHash submitted — pending merchant/admin verification (${deposit.ref_code})`,
    createdBy: 'user',
    metadata: {
      tx_hash: hash,
      p2p_seller_id: metadata.p2p_seller_id,
      p2p_status: 'pending_verification',
    },
  });

  await notifyAdminP2pDepositPending({
    user,
    deposit: updated,
    seller,
    txHash: hash,
  });

  return {
    autoVerified: false,
    pending_p2p: true,
    pending: true,
    deposit: updated,
    message: 'P2P deposit submitted — pending merchant/admin verification. Funds will be released to your wallet after approval.',
  };
}

async function approveP2pUsdtDeposit(deposit, {
  adminNote,
  reviewedBy = 'admin',
  verifyOnChain = true,
} = {}) {
  if (!isP2pDeposit(deposit)) {
    throw new Error('Not a P2P USDT deposit');
  }

  const metadata = parseRecordMetadata(deposit.metadata);
  const network = deposit.usdt_network || metadata.usdt_network || 'TRC20';
  const expectedAddress = metadata.deposit_address;
  const expectedAmount = Number(deposit.amount_usd ?? metadata.amount_usdt ?? 0);
  const txHash = deposit.tx_hash || deposit.txn_id || deposit.kpay_transaction_id;

  if (verifyOnChain && txHash && expectedAddress) {
    const verification = await verifyUsdtTransaction({
      network,
      txHash,
      expectedAddress,
      expectedAmountUsdt: expectedAmount,
    });
    if (!verification.ok) {
      throw new Error(verification.message || 'On-chain verification failed — check TxHash and seller address');
    }
  }

  const result = await creditDepositAndVerify(deposit, {
    txnId: txHash,
    adminNote: adminNote || `P2P deposit approved — ${metadata.p2p_seller_name || 'merchant'}`,
    createdBy: reviewedBy,
  });

  const db = getDb();
  const finalMeta = {
    ...metadata,
    p2p_status: 'released',
    p2p_released_at: new Date().toISOString(),
  };
  await db.run(`
    UPDATE deposit_requests_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?
  `, JSON.stringify(finalMeta), deposit.id);

  return {
    ...result,
    message: `P2P deposit approved — ${formatUsdt(expectedAmount)} credited to wallet`,
  };
}

module.exports = {
  isP2pDeposit,
  createP2pUsdtDepositRequest,
  submitP2pUsdtDeposit,
  approveP2pUsdtDeposit,
};
