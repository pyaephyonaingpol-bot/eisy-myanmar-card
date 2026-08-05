const P2PBuyOrder = require('../models/P2PBuyOrder');
const P2PSellOrder = require('../models/P2PSellOrder');
const P2POrderMessage = require('../models/P2POrderMessage');
const TransactionLog = require('../models/TransactionLog');
const { notifyAdminP2pDisputeOpened } = require('./telegram');

const ACTIVE_DISPUTE_STATUSES = new Set(['pending_payment', 'pending_seller_release', 'pending_merchant_mmk']);

async function openP2pBuyDispute(orderId, userId, { reason, proofPath, txRef } = {}) {
  const order = await P2PBuyOrder.findById(orderId);
  if (!order) throw new Error('Order not found');

  const isTaker = order.user_id === userId;
  const isMaker = order.maker_user_id != null && Number(order.maker_user_id) === Number(userId);
  if (!isTaker && !isMaker) throw new Error('Access denied');

  if (!ACTIVE_DISPUTE_STATUSES.has(order.status)) {
    throw new Error(`Cannot dispute order in status: ${order.status}`);
  }
  if (isMaker && order.status !== 'pending_seller_release') {
    throw new Error('Seller can only open a dispute after the buyer confirms payment');
  }
  if (order.dispute_status === 'open') throw new Error('Dispute already open');

  const defaultReason = isMaker
    ? 'Seller reports MMK payment not received or invalid payment proof'
    : 'User opened dispute';
  const disputeReason = reason || defaultReason;

  const db = require('../db').getDb();
  await db.run(`
    UPDATE p2p_buy_orders
    SET dispute_status = 'open', dispute_reason = ?, dispute_proof_path = ?,
        disputed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `, disputeReason, proofPath || null, orderId);

  await P2POrderMessage.create({
    orderType: 'buy',
    orderId,
    senderRole: 'user',
    senderUserId: userId,
    message: disputeReason,
    attachmentPath: proofPath,
    txRef,
  });

  await P2POrderMessage.create({
    orderType: 'buy',
    orderId,
    senderRole: 'system',
    message: isMaker
      ? 'Seller opened a dispute — escrow locked pending admin review of buyer payment proof.'
      : 'Dispute opened — admin will review payment proof and resolve the order.',
  });

  await TransactionLog.create({
    userId,
    type: 'p2p_buy_order',
    direction: 'neutral',
    amountUsd: order.amount_usdt,
    referenceType: 'p2p_buy_orders',
    referenceId: orderId,
    description: `P2P buy dispute opened — ${order.ref_code}`,
    createdBy: 'user',
    metadata: {
      dispute_status: 'open',
      tx_ref: txRef,
      opened_by: isMaker ? 'seller' : 'buyer',
    },
  });

  const updated = await P2PBuyOrder.findById(orderId);
  await notifyAdminP2pDisputeOpened({
    order: updated,
    orderType: 'buy',
    reason: disputeReason,
    txRef,
    openedBy: isMaker ? 'seller' : 'buyer',
  });
  return updated;
}

async function openP2pSellDispute(orderId, userId, { reason, proofPath, txRef } = {}) {
  const order = await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.user_id !== userId) throw new Error('Access denied');
  if (order.status !== 'pending_merchant_mmk') {
    throw new Error(`Cannot dispute order in status: ${order.status}`);
  }
  if (order.dispute_status === 'open') throw new Error('Dispute already open');

  const db = require('../db').getDb();
  await db.run(`
    UPDATE p2p_sell_orders
    SET dispute_status = 'open', dispute_reason = ?, dispute_proof_path = ?,
        disputed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `, reason || 'User opened dispute', proofPath || null, orderId);

  await P2POrderMessage.create({
    orderType: 'sell',
    orderId,
    senderRole: 'user',
    senderUserId: userId,
    message: reason || 'Dispute opened',
    attachmentPath: proofPath,
    txRef,
  });

  await P2POrderMessage.create({
    orderType: 'sell',
    orderId,
    senderRole: 'system',
    message: 'Dispute opened — admin will review and resolve escrow.',
  });

  await TransactionLog.create({
    userId,
    type: 'p2p_sell_order',
    direction: 'neutral',
    amountUsd: order.amount_usdt,
    referenceType: 'p2p_sell_orders',
    referenceId: orderId,
    description: `P2P sell dispute opened — ${order.ref_code}`,
    createdBy: 'user',
    metadata: { dispute_status: 'open', tx_ref: txRef },
  });

  const updated = await P2PSellOrder.findById(orderId);
  await notifyAdminP2pDisputeOpened({ order: updated, orderType: 'sell', reason, txRef });
  return updated;
}

async function listDisputedOrdersForAdmin() {
  const db = require('../db').getDb();
  const buyRows = await db.all(`
    SELECT 'buy' AS order_type, b.*, u.name AS user_name, u.email AS user_email, m.name AS seller_name
    FROM p2p_buy_orders b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN users m ON m.id = b.maker_user_id
    WHERE b.dispute_status = 'open'
    ORDER BY b.disputed_at DESC
  `);
  const sellRows = await db.all(`
    SELECT 'sell' AS order_type, o.*, u.name AS user_name, u.email AS user_email, m.name AS seller_name
    FROM p2p_sell_orders o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN users m ON m.id = o.maker_user_id
    WHERE o.dispute_status = 'open'
    ORDER BY o.disputed_at DESC
  `);
  return [...buyRows, ...sellRows].sort(
    (a, b) => new Date(b.disputed_at || 0) - new Date(a.disputed_at || 0)
  );
}

async function resolveDispute(orderType, orderId, { resolution, adminNote, reviewedBy = 'admin' } = {}) {
  if (!['buy', 'sell'].includes(orderType)) {
    throw new Error('Invalid order type');
  }
  if (!['force_release', 'refund'].includes(resolution)) {
    throw new Error('Invalid resolution');
  }

  const order = orderType === 'buy'
    ? await P2PBuyOrder.findById(orderId)
    : await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  if (order.dispute_status !== 'open') {
    throw new Error('This dispute is not open');
  }

  const note = adminNote || (resolution === 'force_release'
    ? 'Dispute resolved — USDT released by admin'
    : 'Dispute rejected — escrow refunded by admin');

  const table = orderType === 'buy' ? 'p2p_buy_orders' : 'p2p_sell_orders';
  let result;

  if (orderType === 'buy') {
    if (resolution === 'force_release') {
      if (order.status === 'pending_payment') {
        await P2PBuyOrder.updateStatus(orderId, 'pending_seller_release');
      }
      const { releaseP2pBuyOrder } = require('./p2pBuyOrderService');
      result = await releaseP2pBuyOrder(orderId, {
        adminNote: note,
        reviewedBy,
        finalStatus: 'completed_by_admin',
      });
    } else {
      const { adminRefundP2pBuyOrderDispute } = require('./p2pBuyOrderService');
      result = await adminRefundP2pBuyOrderDispute(orderId, { adminNote: note, reviewedBy });
    }
  } else if (resolution === 'force_release') {
    const { adminReleaseP2pSellOrder } = require('./p2pSellOrderService');
    result = await adminReleaseP2pSellOrder(orderId, { adminNote: note, reviewedBy });
  } else {
    const { adminRefundP2pSellOrder } = require('./p2pSellOrderService');
    result = await adminRefundP2pSellOrder(orderId, { adminNote: note, reviewedBy });
  }

  await dbMarkDisputeResolved(
    table,
    orderId,
    resolution === 'force_release' ? 'resolved_release' : 'resolved_refund',
    note
  );

  await P2POrderMessage.create({
    orderType,
    orderId,
    senderRole: 'system',
    message: resolution === 'force_release'
      ? 'Admin force-released USDT to the buyer.'
      : 'Admin rejected the dispute and refunded escrow to the seller.',
  });

  return {
    ...result,
    message: result.message || (resolution === 'force_release'
      ? 'USDT Force Released to Buyer'
      : 'Dispute Rejected - Escrow Refunded to Seller'),
  };
}

async function dbMarkDisputeResolved(table, orderId, status, adminNote) {
  const db = require('../db').getDb();
  await db.run(`
    UPDATE ${table}
    SET dispute_status = ?, admin_note = COALESCE(?, admin_note), updated_at = datetime('now')
    WHERE id = ?
  `, status, adminNote || null, orderId);
}

module.exports = {
  openP2pBuyDispute,
  openP2pSellDispute,
  listDisputedOrdersForAdmin,
  resolveDispute,
};
