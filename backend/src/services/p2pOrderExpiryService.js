const { getDb } = require('../db');
const P2PBuyOrder = require('../models/P2PBuyOrder');
const P2PSellOrder = require('../models/P2PSellOrder');
const P2PAd = require('../models/P2PAd');
const { refundEscrowHold } = require('./usdtLedgerService');
const TransactionLog = require('../models/TransactionLog');
const P2POrderMessage = require('../models/P2POrderMessage');

const PAYMENT_WINDOW_MINUTES = 15;

function expiresAtFromNow(minutes = PAYMENT_WINDOW_MINUTES) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function autoCancelExpiredBuyOrders() {
  const db = getDb();
  const rows = await db.all(`
    SELECT * FROM p2p_buy_orders
    WHERE status = 'pending_payment'
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
      AND (dispute_status IS NULL OR dispute_status = '')
  `);

  let cancelled = 0;
  for (const order of rows) {
    await P2PBuyOrder.updateStatus(order.id, 'cancelled', {
      adminNote: 'Auto-cancelled — payment not confirmed within 15 minutes',
    });
    if (order.ad_id) {
      await P2PAd.restoreVolume(order.ad_id, Number(order.amount_usdt));
    }
    await db.run(
      `UPDATE p2p_buy_orders SET auto_cancelled_at = datetime('now') WHERE id = ?`,
      order.id
    );
    await TransactionLog.create({
      userId: order.user_id,
      type: 'p2p_buy_order',
      direction: 'neutral',
      amountUsd: order.amount_usdt,
      referenceType: 'p2p_buy_orders',
      referenceId: order.id,
      description: `P2P buy order ${order.ref_code} auto-cancelled (15 min timeout)`,
      createdBy: 'system',
      metadata: { auto_cancelled: true, reason: 'payment_timeout' },
    });
    await P2POrderMessage.create({
      orderType: 'buy',
      orderId: order.id,
      senderRole: 'system',
      message: 'Order auto-cancelled — MMK payment was not confirmed within 15 minutes.',
    });
    cancelled += 1;
  }
  return cancelled;
}

async function autoCancelExpiredSellOrders() {
  const db = getDb();
  const rows = await db.all(`
    SELECT * FROM p2p_sell_orders
    WHERE status = 'pending_merchant_mmk'
      AND expires_at IS NOT NULL
      AND datetime(expires_at) <= datetime('now')
      AND (dispute_status IS NULL OR dispute_status = '')
  `);

  let cancelled = 0;
  for (const order of rows) {
    const amountUsdt = Number(order.amount_usdt);
    await refundEscrowHold({
      userId: order.user_id,
      referenceType: 'p2p_sell_orders',
      referenceId: order.id,
      holdType: 'p2p_sell_order',
      amountUsdt,
      description: `P2P sell order auto-cancelled — ${order.ref_code} escrow refunded (15 min timeout)`,
      createdBy: 'system',
      metadata: { auto_cancelled: true, escrow_refund: true },
    });
    await P2PSellOrder.updateStatus(order.id, 'cancelled', {
      adminNote: 'Auto-cancelled — MMK not received within 15 minutes; USDT escrow refunded',
    });
    if (order.ad_id) {
      await P2PAd.restoreVolume(order.ad_id, amountUsdt);
    }
    await db.run(
      `UPDATE p2p_sell_orders SET auto_cancelled_at = datetime('now') WHERE id = ?`,
      order.id
    );
    await TransactionLog.create({
      userId: order.user_id,
      type: 'p2p_sell_order_cancelled',
      direction: 'credit',
      amountUsd: amountUsdt,
      referenceType: 'p2p_sell_orders',
      referenceId: order.id,
      description: `P2P sell order ${order.ref_code} auto-cancelled — escrow refunded`,
      createdBy: 'system',
    });
    await P2POrderMessage.create({
      orderType: 'sell',
      orderId: order.id,
      senderRole: 'system',
      message: 'Order auto-cancelled — MMK was not confirmed within 15 minutes. USDT escrow returned to your wallet.',
    });
    cancelled += 1;
  }
  return cancelled;
}

async function processExpiredP2pOrders() {
  const buyCancelled = await autoCancelExpiredBuyOrders();
  const sellCancelled = await autoCancelExpiredSellOrders();
  return { buy_cancelled: buyCancelled, sell_cancelled: sellCancelled };
}

module.exports = {
  PAYMENT_WINDOW_MINUTES,
  expiresAtFromNow,
  processExpiredP2pOrders,
};
