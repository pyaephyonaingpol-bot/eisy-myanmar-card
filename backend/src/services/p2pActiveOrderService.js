const User = require('../models/User');
const P2PAd = require('../models/P2PAd');
const { listP2pBuyOrdersForUser, mapPaymentAccountForClient } = require('./p2pBuyOrderService');
const { listP2pSellOrdersForUser } = require('./p2pSellOrderService');
const { getPaymentAccountFromAd } = require('./p2pAdService');
const { PAYMENT_WINDOW_MINUTES } = require('./p2pOrderExpiryService');

const ACTIVE_BUY_STATUSES = ['pending_payment', 'pending_seller_release'];
const ACTIVE_SELL_STATUSES = ['pending_merchant_mmk'];

function computeTimerInfo(order, orderType) {
  const expiresAt = order.expires_at;
  const showTimer = orderType === 'buy'
    ? order.status === 'pending_payment'
    : order.status === 'pending_merchant_mmk';
  if (!showTimer || !expiresAt) {
    return {
      expires_at: expiresAt || null,
      payment_window_minutes: PAYMENT_WINDOW_MINUTES,
      seconds_remaining: null,
      timer_expired: false,
      show_timer: false,
    };
  }
  const expiresMs = new Date(String(expiresAt).replace(' ', 'T') + 'Z').getTime();
  const remaining = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
  return {
    expires_at: expiresAt,
    payment_window_minutes: PAYMENT_WINDOW_MINUTES,
    seconds_remaining: remaining,
    timer_expired: remaining <= 0,
    show_timer: true,
  };
}

function enrichOrderExtras(order, orderType) {
  const timer = computeTimerInfo(order, orderType);
  const isDisputed = order.dispute_status === 'open' || order.is_disputed;
  return {
    ...timer,
    is_disputed: isDisputed,
    dispute_status: order.dispute_status || null,
    dispute_reason: order.dispute_reason || null,
    dispute_proof_path: order.dispute_proof_path || null,
    payment_tx_ref: order.payment_tx_ref || null,
    payment_proof_path: order.payment_proof_path || null,
    payment_proof_url: order.payment_proof_path || null,
    paymentProofUrl: order.payment_proof_path || null,
    disputed_at: order.disputed_at || null,
    status_badge: isDisputed ? 'DISPUTED — Under Review' : undefined,
  };
}

function mapDisplayStatus(orderType, status, { isMaker, makerCanRelease } = {}) {
  if (orderType === 'sell' && status === 'pending_merchant_mmk') {
    return {
      label: 'Escrowed',
      code: 'ESCROWED',
      status_badge: 'Escrowed — Action Required',
      action_label: 'Resume / View Details',
      requires_action: true,
    };
  }
  if (orderType === 'buy' && status === 'pending_payment') {
    return {
      label: 'Pending Payment',
      code: 'PENDING_PAYMENT',
      status_badge: 'Pending Payment — Action Required',
      action_label: 'Resume / View Details',
      requires_action: true,
    };
  }
  if (orderType === 'buy' && status === 'pending_seller_release') {
    return {
      label: isMaker && makerCanRelease ? 'Confirm & Release USDT' : 'Pending Release',
      code: 'PENDING_RELEASE',
      status_badge: isMaker && makerCanRelease ? 'Buyer paid — Release USDT' : 'Pending Release',
      action_label: isMaker && makerCanRelease ? 'Release USDT to Buyer' : 'Resume / View Details',
      requires_action: Boolean(isMaker && makerCanRelease),
      maker_can_release: Boolean(isMaker && makerCanRelease),
    };
  }
  return {
    label: status,
    code: String(status || '').toUpperCase(),
    status_badge: String(status || 'Unknown'),
    action_label: 'Resume / View Details',
    requires_action: false,
  };
}

async function resolvePaymentAccount(order) {
  if (order.status !== 'pending_payment' || !order.ad_id) return null;
  const ad = await P2PAd.findById(order.ad_id);
  if (!ad) return null;
  const raw = await getPaymentAccountFromAd(ad, order.payment_method);
  return mapPaymentAccountForClient(raw);
}

async function listActiveP2pOrdersForUser(userId) {
  const [buyOrders, sellOrders] = await Promise.all([
    listP2pBuyOrdersForUser(userId),
    listP2pSellOrdersForUser(userId),
  ]);

  const activeBuy = await Promise.all(
    buyOrders
      .filter((o) => ACTIVE_BUY_STATUSES.includes(o.status))
      .map(async (order) => {
        const isMaker = order.maker_user_id === userId;
        const isTaker = order.user_id === userId;
        const role = isMaker ? 'maker' : 'taker';
        const counterpartyId = isMaker ? order.user_id : order.maker_user_id;
        let counterpartyName = order.seller_name;
        if (counterpartyId) {
          const cp = await User.findById(counterpartyId);
          counterpartyName = cp?.name || counterpartyName;
        }
        const payment_account = isTaker ? await resolvePaymentAccount(order) : null;
        const display = mapDisplayStatus('buy', order.status, {
          isMaker,
          makerCanRelease: isMaker && order.status === 'pending_seller_release',
        });
        const extras = enrichOrderExtras(order, 'buy');
        return {
          order_type: 'buy',
          role,
          ...order,
          ...extras,
          payment_account,
          counterparty_name: counterpartyName,
          seller_name: counterpartyName || order.seller_name,
          display_status: extras.is_disputed ? 'Disputed' : display.label,
          display_status_code: extras.is_disputed ? 'DISPUTED' : display.code,
          status_badge: extras.status_badge || display.status_badge,
          action_label: display.action_label,
          requires_action: display.requires_action,
          maker_can_release: display.maker_can_release || false,
          escrow_amount_usdt: Number(order.amount_usdt),
          summary: `Order ${order.ref_code} | ${Number(order.amount_usdt).toFixed(2)} USDT | Status: ${display.label}`,
        };
      })
  );

  const activeSell = await Promise.all(
    sellOrders
      .filter((o) => ACTIVE_SELL_STATUSES.includes(o.status))
      .map(async (order) => {
        const isMaker = order.maker_user_id === userId;
        const role = order.user_id === userId ? 'taker' : 'maker';
        let counterpartyName = order.seller_name;
        if (order.maker_user_id) {
          const cp = await User.findById(order.maker_user_id);
          counterpartyName = cp?.name || counterpartyName;
        }
        const display = mapDisplayStatus('sell', order.status);
        const extras = enrichOrderExtras(order, 'sell');
        return {
          order_type: 'sell',
          role,
          ...order,
          ...extras,
          counterparty_name: counterpartyName,
          seller_name: counterpartyName || order.seller_name,
          display_status: extras.is_disputed ? 'Disputed' : display.label,
          display_status_code: extras.is_disputed ? 'DISPUTED' : display.code,
          status_badge: extras.status_badge || display.status_badge,
          action_label: display.action_label,
          requires_action: display.requires_action,
          escrow_amount_usdt: Number(order.amount_usdt),
          summary: `Order ${order.ref_code} | ${Number(order.amount_usdt).toFixed(2)} USDT | Status: ${display.label}`,
        };
      })
  );

  return [...activeSell, ...activeBuy].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

async function getActiveP2pOrderForUser(userId, orderType, orderId) {
  const orders = await listActiveP2pOrdersForUser(userId);
  return orders.find(
    (o) => o.order_type === orderType && o.id === parseInt(orderId, 10)
  ) || null;
}

module.exports = {
  listActiveP2pOrdersForUser,
  getActiveP2pOrderForUser,
  mapDisplayStatus,
};
