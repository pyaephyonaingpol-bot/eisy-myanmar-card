const User = require('../models/User');
const P2PBuyOrder = require('../models/P2PBuyOrder');
const P2PSellOrder = require('../models/P2PSellOrder');
const P2POrderMessage = require('../models/P2POrderMessage');

async function assertOrderAccess(orderType, orderId, userId) {
  const order = orderType === 'buy'
    ? await P2PBuyOrder.findById(orderId)
    : await P2PSellOrder.findById(orderId);
  if (!order) throw new Error('Order not found');
  const isTaker = order.user_id === userId;
  const isMaker = order.maker_user_id != null && Number(order.maker_user_id) === Number(userId);
  if (!isTaker && !isMaker) throw new Error('Access denied');
  return order;
}

async function listOrderMessages(orderType, orderId, userId) {
  await assertOrderAccess(orderType, orderId, userId);
  const rows = await P2POrderMessage.listForOrder(orderType, orderId);
  return Promise.all(rows.map(async (row) => {
    let userName = null;
    if (row.sender_user_id) {
      const u = await User.findById(row.sender_user_id);
      userName = u?.name;
    }
    return P2POrderMessage.mapForClient(row, { userName });
  }));
}

async function postOrderMessage(orderType, orderId, userId, { message, attachmentPath, txRef } = {}) {
  await assertOrderAccess(orderType, orderId, userId);
  if (!message && !attachmentPath && !txRef) {
    throw new Error('Message, attachment, or TxRef required');
  }
  const row = await P2POrderMessage.create({
    orderType,
    orderId,
    senderRole: 'user',
    senderUserId: userId,
    message,
    attachmentPath,
    txRef,
  });
  const user = await User.findById(userId);
  return P2POrderMessage.mapForClient(row, { userName: user?.name });
}

async function listOrderMessagesForAdmin(orderType, orderId) {
  const rows = await P2POrderMessage.listForOrder(orderType, orderId);
  return Promise.all(rows.map(async (row) => {
    let userName = null;
    if (row.sender_user_id) {
      const u = await User.findById(row.sender_user_id);
      userName = u?.name;
    }
    return P2POrderMessage.mapForClient(row, { userName });
  }));
}

async function postAdminOrderMessage(orderType, orderId, { message, attachmentPath } = {}) {
  const row = await P2POrderMessage.create({
    orderType,
    orderId,
    senderRole: 'admin',
    senderUserId: null,
    message,
    attachmentPath,
  });
  return P2POrderMessage.mapForClient(row, { userName: 'Admin' });
}

module.exports = {
  listOrderMessages,
  postOrderMessage,
  listOrderMessagesForAdmin,
  postAdminOrderMessage,
};
