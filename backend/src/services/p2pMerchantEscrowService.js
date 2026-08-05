const { getDb } = require('../db');
const P2PSeller = require('../models/P2PSeller');
const TransactionLog = require('../models/TransactionLog');

async function getReservedEscrowUsdt(sellerId, side) {
  const db = getDb();
  const normalizedSide = side === 'buy' ? 'buy' : 'sell';

  if (normalizedSide === 'sell') {
    const row = await db.get(`
      SELECT COALESCE(SUM(amount_usdt), 0) AS total
      FROM p2p_buy_orders
      WHERE seller_id = ?
        AND status IN ('pending_payment', 'pending_seller_release')
    `, sellerId);
    return Number(row?.total || 0);
  }

  const row = await db.get(`
    SELECT COALESCE(SUM(amount_usdt), 0) AS total
    FROM p2p_sell_orders
    WHERE seller_id = ?
      AND status = 'pending_merchant_mmk'
  `, sellerId);
  return Number(row?.total || 0);
}

async function getMerchantEscrowSnapshot(sellerId) {
  const seller = await P2PSeller.findById(sellerId);
  if (!seller) return null;

  const balance = Number(seller.escrow_balance_usdt || 0);
  const side = seller.side || 'sell';
  const reserved = await getReservedEscrowUsdt(sellerId, side);
  const available = Math.max(0, balance - reserved);

  return {
    seller_id: sellerId,
    side,
    balance,
    reserved,
    available,
  };
}

async function assertMerchantEscrowForTrade(sellerId, amountUsdt) {
  const seller = await P2PSeller.findById(sellerId);
  if (!seller) throw new Error('Merchant not found');
  if (seller.status !== 'active') throw new Error('Merchant is not active');
  if (seller.is_online != null && !seller.is_online) {
    throw new Error('Merchant is currently offline');
  }

  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid trade amount');
  }

  const snap = await getMerchantEscrowSnapshot(sellerId);
  if (snap.available < amount) {
    throw new Error(
      `Merchant has insufficient escrow liquidity (${snap.available.toFixed(2)} USDT available, ${amount.toFixed(2)} USDT required). Admin must deposit more USDT to the merchant pool.`
    );
  }

  return { seller, escrow: snap };
}

async function logEscrowMovement(sellerId, { direction, amountUsdt, balanceAfter, note, createdBy = 'admin' }) {
  const db = getDb();
  await db.run(`
    INSERT INTO p2p_merchant_escrow_logs (seller_id, direction, amount_usdt, balance_after, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `, sellerId, direction, amountUsdt, balanceAfter, note || null, createdBy);
}

async function depositMerchantEscrow(sellerId, amountUsdt, { note, createdBy = 'admin' } = {}) {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid deposit amount');

  const seller = await P2PSeller.findById(sellerId);
  if (!seller) throw new Error('Merchant not found');

  const updated = await P2PSeller.adjustEscrowBalance(sellerId, amount);
  const balanceAfter = Number(updated.escrow_balance_usdt || 0);

  await logEscrowMovement(sellerId, {
    direction: 'deposit',
    amountUsdt: amount,
    balanceAfter,
    note: note || 'Admin escrow deposit',
    createdBy,
  });

  await TransactionLog.create({
    userId: null,
    type: 'p2p_merchant_escrow_deposit',
    direction: 'credit',
    amountUsd: amount,
    referenceType: 'p2p_sellers',
    referenceId: sellerId,
    description: `P2P merchant escrow deposit — ${seller.name}: +${amount.toFixed(2)} USDT`,
    createdBy,
    metadata: { seller_id: sellerId, seller_name: seller.name, note },
  });

  const snapshot = await getMerchantEscrowSnapshot(sellerId);
  return {
    seller: P2PSeller.mapForClient(updated, { escrow: snapshot }),
    escrow: snapshot,
    message: `Deposited ${amount.toFixed(2)} USDT to merchant escrow pool`,
  };
}

async function withdrawMerchantEscrow(sellerId, amountUsdt, { note, createdBy = 'admin' } = {}) {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid withdrawal amount');

  const seller = await P2PSeller.findById(sellerId);
  if (!seller) throw new Error('Merchant not found');

  const snap = await getMerchantEscrowSnapshot(sellerId);
  if (snap.available < amount) {
    throw new Error(
      `Cannot withdraw ${amount.toFixed(2)} USDT — only ${snap.available.toFixed(2)} USDT available (${snap.reserved.toFixed(2)} USDT reserved in open orders)`
    );
  }

  const updated = await P2PSeller.adjustEscrowBalance(sellerId, -amount);
  const balanceAfter = Number(updated.escrow_balance_usdt || 0);

  await logEscrowMovement(sellerId, {
    direction: 'withdraw',
    amountUsdt: amount,
    balanceAfter,
    note: note || 'Admin escrow withdrawal',
    createdBy,
  });

  await TransactionLog.create({
    userId: null,
    type: 'p2p_merchant_escrow_withdraw',
    direction: 'debit',
    amountUsd: amount,
    referenceType: 'p2p_sellers',
    referenceId: sellerId,
    description: `P2P merchant escrow withdrawal — ${seller.name}: -${amount.toFixed(2)} USDT`,
    createdBy,
    metadata: { seller_id: sellerId, seller_name: seller.name, note },
  });

  const snapshot = await getMerchantEscrowSnapshot(sellerId);
  return {
    seller: P2PSeller.mapForClient(updated, { escrow: snapshot }),
    escrow: snapshot,
    message: `Withdrew ${amount.toFixed(2)} USDT from merchant escrow pool`,
  };
}

async function consumeMerchantEscrowOnBuyRelease(sellerId, amountUsdt, { orderId, refCode, reviewedBy = 'admin' } = {}) {
  const amount = Number(amountUsdt);
  const seller = await P2PSeller.findById(sellerId);
  if (!seller) return null;

  const updated = await P2PSeller.adjustEscrowBalance(sellerId, -amount);
  await TransactionLog.create({
    userId: null,
    type: 'p2p_merchant_escrow_release',
    direction: 'debit',
    amountUsd: amount,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    description: `P2P buy order ${refCode} released — ${amount.toFixed(2)} USDT deducted from ${seller.name} escrow pool`,
    createdBy: reviewedBy,
    metadata: { seller_id: sellerId, order_id: orderId, ref_code: refCode },
  });
  return updated;
}

async function creditMerchantEscrowOnSellRelease(sellerId, netUsdt, { orderId, refCode, reviewedBy = 'user' } = {}) {
  const amount = Number(netUsdt);
  if (amount <= 0) return null;
  const seller = await P2PSeller.findById(sellerId);
  if (!seller) return null;

  const updated = await P2PSeller.adjustEscrowBalance(sellerId, amount);
  await TransactionLog.create({
    userId: null,
    type: 'p2p_merchant_escrow_credit',
    direction: 'credit',
    amountUsd: amount,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    description: `P2P sell order ${refCode} — ${amount.toFixed(2)} USDT credited to ${seller.name} escrow pool`,
    createdBy: reviewedBy,
    metadata: { seller_id: sellerId, order_id: orderId, ref_code: refCode },
  });
  return updated;
}

async function listEscrowLogsForMerchant(sellerId, { limit = 30 } = {}) {
  const db = getDb();
  return db.all(`
    SELECT * FROM p2p_merchant_escrow_logs
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, sellerId, limit);
}

async function enrichSellerWithEscrow(row) {
  if (!row) return null;
  const escrow = await getMerchantEscrowSnapshot(row.id);
  return P2PSeller.mapForClient(row, { escrow });
}

module.exports = {
  getReservedEscrowUsdt,
  getMerchantEscrowSnapshot,
  assertMerchantEscrowForTrade,
  depositMerchantEscrow,
  withdrawMerchantEscrow,
  consumeMerchantEscrowOnBuyRelease,
  creditMerchantEscrowOnSellRelease,
  listEscrowLogsForMerchant,
  enrichSellerWithEscrow,
};
