const TelegramBot = require('node-telegram-bot-api');

let bot = null;

function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    return null;
  }
  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

function getAdminChatId() {
  return String(
    process.env.TELEGRAM_ADMIN_CHAT_ID
    || process.env.TELEGRAM_CHAT_ID
    || process.env.TELEGRAM_SUPPORT_CHAT_ID
    || ''
  ).trim();
}

function isTelegramConfigured() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = getAdminChatId();
  if (!token || token === 'your_telegram_bot_token_here') return false;
  if (!chatId || chatId === 'your_admin_chat_id_here') return false;
  return true;
}

/**
 * Send a message to the admin Telegram chat/group.
 * @returns {Promise<{ ok: boolean, message?: object, chatId?: string, skipped?: boolean, error?: string }>}
 */
function queueAdminNotify(task) {
  return Promise.resolve()
    .then(task)
    .catch((err) => {
      console.warn('[Telegram] notify failed:', err.message);
      return { ok: false, error: err.message };
    });
}

async function sendAdminMessage(message, options = {}) {
  const { loadTelegramClient } = require('./loadTelegramClient');
  return loadTelegramClient().sendAdminMessage(message, options);
}

function notifyAdminDepositRequest(payload) {
  const { loadTelegramClient } = require('./loadTelegramClient');
  return queueAdminNotify(() => loadTelegramClient().notifyAdminDepositRequest(payload));
}

function notifyAdminCardCreated(payload) {
  const { loadTelegramClient } = require('./loadTelegramClient');
  return queueAdminNotify(() => loadTelegramClient().notifyAdminCardCreated(payload));
}

function notifyAdminWithdrawalRequest(payload) {
  const { loadTelegramClient } = require('./loadTelegramClient');
  return queueAdminNotify(() => loadTelegramClient().notifyAdminWithdrawalRequest(payload));
}

function notifyAdminDepositForUser(userId, payload) {
  const User = require('../models/User');
  return User.findById(userId)
    .then((user) => notifyAdminDepositRequest({ user, ...payload }))
    .catch((err) => {
      console.warn('[Telegram] deposit notify skipped:', err.message);
      return { ok: false, error: err.message };
    });
}

function notifyAdminWithdrawalForUser(userId, payload) {
  const User = require('../models/User');
  return User.findById(userId)
    .then((user) => notifyAdminWithdrawalRequest({ user, ...payload }))
    .catch((err) => {
      console.warn('[Telegram] withdrawal notify skipped:', err.message);
      return { ok: false, error: err.message };
    });
}

async function notifyAdminDepositVerified({ user, deposit, txnId, senderPhone }) {
  const message = [
    '✅ *Deposit Auto-Verified*',
    '',
    `👤 User: ${user?.name || 'Unknown'} (${user?.phone || user?.email || 'N/A'})`,
    `💰 Amount: ${Number(deposit.amount_mmk || 0).toLocaleString()} MMK ($${Number(deposit.amount_usd || 0).toFixed(2)} USD)`,
    `🔖 Ref Code: \`${deposit.ref_code}\``,
    `📱 Sender: ${senderPhone || 'N/A'}`,
    `🧾 Txn ID: ${txnId || 'N/A'}`,
  ].join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] Admin notified for deposit', deposit.ref_code);
  try {
    const { notifyUserPush } = require('./webPushService');
    const usd = Number(deposit?.amount_usd || 0);
    notifyUserPush(user?.id, {
      title: 'USDT deposit confirmed',
      body: usd > 0
        ? `$${usd.toFixed(2)} USDT was credited to your wallet.`
        : 'Your deposit was credited to your wallet.',
      url: '/#usdt-wallet',
      tag: `eisy-deposit-${deposit?.ref_code || 'deposit'}`,
    }).catch((err) => console.warn('[push] deposit:', err.message));
  } catch (err) {
    console.warn('[push] deposit skipped:', err.message);
  }
}

async function notifyAdminP2pDepositPending({ user, deposit, seller, txHash }) {
  const message = [
    '🔔 *P2P USDT Deposit — Pending Verification*',
    '',
    `👤 User: ${user?.name || 'Unknown'} (${user?.email || user?.phone || 'N/A'})`,
    `🏪 Merchant: ${seller?.name || 'Unknown'} (${seller?.network || 'USDT'})`,
    `💰 Amount: $${Number(deposit.amount_usd || 0).toFixed(2)} USDT`,
    `🔖 Ref: \`${deposit.ref_code}\``,
    `🧾 TxHash: \`${txHash || deposit.tx_hash || 'N/A'}\``,
    `📍 Seller wallet: \`${seller?.wallet_address || 'N/A'}\``,
    '',
    '_Verify on-chain and approve in Admin Portal to release escrow to user wallet._',
  ].join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] P2P deposit pending notification sent for', deposit.ref_code);
}

async function notifyAdminP2pBuyOrderPending({ user, order, seller }) {
  const message = [
    '💱 *P2P Buy USDT — Pending Seller Release*',
    '',
    `👤 User: ${user?.name || 'Unknown'} (${user?.email || user?.phone || 'N/A'})`,
    `🏪 Merchant: ${seller?.name || 'Unknown'}`,
    `💰 USDT: $${Number(order.amount_usdt || 0).toFixed(2)}`,
    `💵 MMK: ${Math.round(Number(order.amount_mmk || 0)).toLocaleString()} MMK`,
    `💳 Payment: ${order.payment_method || 'N/A'}`,
    `🔖 Ref: \`${order.ref_code}\``,
    '',
    '_User confirmed MMK transfer. Verify receipt and release USDT to user wallet in Admin Portal._',
  ].join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] P2P buy order pending release notification sent for', order.ref_code);
}

async function notifyAdminP2pSellOrderPending({ user, order, seller, userPaymentAccount }) {
  const acct = userPaymentAccount || {};
  const message = [
    '💸 *P2P Sell USDT — USDT Escrowed*',
    '',
    `👤 User: ${user?.name || 'Unknown'} (${user?.email || user?.phone || 'N/A'})`,
    `🏪 Merchant: ${seller?.name || 'Unknown'}`,
    `💰 USDT Escrowed: $${Number(order.amount_usdt || 0).toFixed(2)}`,
    `💵 MMK Due: ${Math.round(Number(order.amount_mmk || 0)).toLocaleString()} MMK`,
    `💳 User receives via: ${acct.method || order.payment_method || 'N/A'}`,
    `📱 User account: ${acct.account_name || 'N/A'} / ${acct.account_number || 'N/A'}`,
    `🔖 Ref: \`${order.ref_code}\``,
    '',
    '_Merchant should send MMK to user external account. User will confirm MMK receipt and release escrow._',
  ].join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] P2P sell order escrow notification sent for', order.ref_code);
}

async function notifyAdminP2pDisputeOpened({ order, orderType, reason, txRef }) {
  const sideLabel = orderType === 'buy' ? 'Buy USDT' : 'Sell USDT';
  const message = [
    `⚠️ *P2P ${sideLabel} — DISPUTE OPENED*`,
    '',
    `🔖 Ref: \`${order.ref_code}\``,
    `💰 USDT: $${Number(order.amount_usdt || 0).toFixed(2)}`,
    `💵 MMK: ${Math.round(Number(order.amount_mmk || 0)).toLocaleString()} MMK`,
    `📝 Reason: ${reason || 'User opened dispute'}`,
    txRef ? `🧾 TxRef: \`${txRef}\`` : null,
    order.dispute_proof_path ? `📎 Proof: ${order.dispute_proof_path}` : null,
    '',
    '_Review proof in Admin Portal → P2P Disputes and force-release or refund._',
  ].filter(Boolean).join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] P2P dispute notification sent for', order.ref_code);
}

async function notifyAdminP2pSellOrderReleased({ user, order, seller }) {
  const message = [
    '✅ *P2P Sell USDT — Escrow Released*',
    '',
    `👤 User: ${user?.name || 'Unknown'} (${user?.email || user?.phone || 'N/A'})`,
    `🏪 Merchant: ${seller?.name || 'Unknown'}`,
    `💰 USDT Released: $${Number(order.amount_usdt || 0).toFixed(2)}`,
    `💵 MMK Received (external): ${Math.round(Number(order.amount_mmk || 0)).toLocaleString()} MMK`,
    `🔖 Ref: \`${order.ref_code}\``,
    '',
    '_User confirmed MMK receipt and released escrowed USDT to merchant._',
  ].join('\n');

  await sendAdminMessage(message);
  console.log('[Telegram] P2P sell order released notification sent for', order.ref_code);
}

module.exports = {
  getBot,
  getAdminChatId,
  isTelegramConfigured,
  sendAdminMessage,
  notifyAdminDepositRequest,
  notifyAdminDepositForUser,
  notifyAdminCardCreated,
  notifyAdminWithdrawalRequest,
  notifyAdminWithdrawalForUser,
  notifyAdminDepositVerified,
  notifyAdminP2pDepositPending,
  notifyAdminP2pBuyOrderPending,
  notifyAdminP2pSellOrderPending,
  notifyAdminP2pSellOrderReleased,
  notifyAdminP2pDisputeOpened,
};
