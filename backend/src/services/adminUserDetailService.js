const { getDb } = require('../db');
const User = require('../models/User');
const Card = require('../models/Card');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const { mapCardForAdmin } = require('./cardBalanceService');
const { displayStatusLabel } = require('../constants/cardStatuses');
const {
  listUsdtDepositAdminTransactions,
  listUsdtWithdrawalAdminTransactions,
  listMmkWithdrawalAdminTransactions,
} = require('./adminLedgerTransactionService');
const { loadPagoCardClient } = require('./loadPagoCardClient');
const { normalizePagoCardTransactions } = require('./pagoCardService');

function clampPage(limitRaw, offsetRaw, maxLimit = 100) {
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), maxLimit);
  const offset = Math.max(parseInt(offsetRaw, 10) || 0, 0);
  return { limit, offset };
}

function parseCardMeta(card) {
  try {
    return card?.metadata ? JSON.parse(card.metadata) : {};
  } catch (_) {
    return {};
  }
}

function mapUserDetailCard(card, user) {
  const base = mapCardForAdmin(card, user);
  const meta = parseCardMeta(card);
  const digits = String(card.card_number || '').replace(/\D/g, '');
  return {
    ...base,
    pago_card_id: card.pago_card_id || meta.pago_card_id || null,
    brand: card.brand || meta.brand || null,
    product_code: card.product_code || meta.product_code || null,
    pago_status: card.pago_status || meta.pago_status || null,
    masked_number: digits.length >= 4
      ? `•••• •••• •••• ${digits.slice(-4)}`
      : base.label,
  };
}

async function getAdminUserProfile(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return {
    id: user.id,
    auth_user_id: user.auth_user_id || null,
    name: user.name || null,
    email: user.email || null,
    phone: user.phone || null,
    auth_status: user.auth_status || 'active',
    created_at: user.created_at || null,
    balance_usdt: Number(user.balance_usdt || 0),
    balance_mmk: Number(user.balance_mmk || 0),
    balance_usd: Number(user.balance || 0),
  };
}

async function listUserFinanceDeposits(userId, { limit, offset } = {}) {
  const page = clampPage(limit, offset);
  const db = getDb();
  const countRow = await db.get(
    `SELECT COUNT(*) AS total FROM deposit_requests_v2 WHERE user_id = ?`,
    userId
  );
  const total = Number(countRow?.total || 0);
  const fetchCap = Math.min(Math.max(total, page.offset + page.limit), 5000);
  const all = await listUsdtDepositAdminTransactions({ userId, limit: fetchCap });
  const rows = all.slice(page.offset, page.offset + page.limit);

  return {
    kind: 'deposits',
    rows,
    total,
    limit: page.limit,
    offset: page.offset,
    has_more: page.offset + page.limit < total,
  };
}

async function listUserFinanceWithdrawals(userId, { limit, offset, currency = 'usdt' } = {}) {
  const page = clampPage(limit, offset);
  const kind = String(currency || 'usdt').toLowerCase();

  if (kind === 'mmk') {
    const all = await listMmkWithdrawalAdminTransactions({ userId, limit: 5000 });
    const total = all.length;
    const rows = all.slice(page.offset, page.offset + page.limit);
    return {
      kind: 'mmk_withdrawals',
      rows,
      total,
      limit: page.limit,
      offset: page.offset,
      has_more: page.offset + page.limit < total,
    };
  }

  const db = getDb();
  const countRow = await db.get(
    `SELECT COUNT(*) AS total FROM usdt_withdrawal_requests WHERE user_id = ?`,
    userId
  );
  const all = await listUsdtWithdrawalAdminTransactions({ userId, limit: page.limit + page.offset });
  const rows = all.slice(page.offset, page.offset + page.limit);
  return {
    kind: 'usdt_withdrawals',
    rows,
    total: Number(countRow?.total || all.length),
    limit: page.limit,
    offset: page.offset,
    has_more: page.offset + page.limit < Number(countRow?.total || all.length),
  };
}

async function listUserDetailCards(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const cards = await Card.findByUserId(userId);
  return cards
    .filter((c) => c.status !== 'cancelled')
    .map((c) => mapUserDetailCard(c, user));
}

async function listUserCardSpendTransactions(userId, { limit, offset } = {}) {
  const page = clampPage(limit, offset, 50);
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const db = getDb();
  const logRows = await db.all(`
    SELECT tl.* FROM transaction_logs tl
    WHERE tl.user_id = ?
      AND tl.type IN ('card_transaction', 'card_topup', 'card_withdraw', 'card_issued')
    ORDER BY tl.created_at DESC
    LIMIT ?
  `, userId, 100);

  const pagoRows = [];
  const cards = (await Card.findByUserId(userId))
    .filter((c) => c.pago_card_id && c.status !== 'cancelled')
    .slice(0, 5);

  const client = loadPagoCardClient().createPagoCardClient({ timeoutMs: 8000 });
  if (typeof client.listCardTransactions === 'function') {
    for (const card of cards) {
      try {
        const payload = await client.listCardTransactions(card.pago_card_id, 1);
        const normalized = normalizePagoCardTransactions(payload);
        for (const tx of normalized) {
          pagoRows.push({
            source: 'pago',
            local_card_id: card.id,
            pago_card_id: card.pago_card_id,
            merchant: tx.merchant_name || tx.merchant || tx.description || null,
            amount_usd: tx.amount_usd ?? tx.amount ?? null,
            status: tx.status || null,
            created_at: tx.created_at || tx.date || tx.transaction_date || null,
            currency: tx.currency || 'USD',
          });
        }
      } catch (err) {
        console.warn('[admin/user-detail] pago tx skipped:', card.pago_card_id, err.message);
      }
    }
  }

  const merged = [
    ...logRows.map((row) => {
      let meta = {};
      try { meta = row.metadata ? JSON.parse(row.metadata) : {}; } catch (_) { /* ignore */ }
      return {
        source: 'ledger',
        id: row.id,
        type: row.type,
        description: row.description,
        amount_usd: meta.amount_usd ?? meta.top_up_usd ?? meta.withdraw_usd ?? null,
        merchant: meta.merchant || null,
        status: row.type,
        created_at: row.created_at,
        local_card_id: meta.reference_id || row.reference_id || null,
      };
    }),
    ...pagoRows,
  ].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });

  const total = merged.length;
  const rows = merged.slice(page.offset, page.offset + page.limit);

  return {
    rows,
    total,
    limit: page.limit,
    offset: page.offset,
    has_more: page.offset + page.limit < total,
  };
}

async function listUserSupportThreads(userId) {
  return SupportThread.findByUserId(userId);
}

async function getUserSupportThreadMessages(threadId, userId) {
  const thread = await SupportThread.findById(threadId);
  if (!thread || Number(thread.user_id) !== Number(userId)) {
    const err = new Error('Support thread not found');
    err.status = 404;
    throw err;
  }
  const messages = await SupportMessage.findByThreadId(threadId);
  return { thread, messages };
}

async function replyToUserSupport(userId, { message, threadId, subject } = {}) {
  const text = String(message || '').trim();
  if (!text) {
    const err = new Error('Message is required');
    err.status = 400;
    throw err;
  }

  let thread = null;
  if (threadId) {
    thread = await SupportThread.findById(threadId);
    if (!thread || Number(thread.user_id) !== Number(userId)) {
      const err = new Error('Support thread not found');
      err.status = 404;
      throw err;
    }
  } else {
    const existing = await SupportThread.findByUserId(userId);
    thread = existing.find((t) => t.status !== 'closed') || existing[0] || null;
    if (!thread) {
      thread = await SupportThread.create({
        userId,
        subject: subject || 'Admin follow-up',
        category: 'general',
        priority: 'medium',
        status: 'in_progress',
      });
    }
  }

  const created = await SupportMessage.create({
    threadId: thread.id,
    senderType: 'admin',
    senderId: null,
    message: text,
  });

  await SupportThread.updateAfterMessage(thread.id, text, 'admin');
  if (thread.status === 'pending' || thread.status === 'open') {
    await SupportThread.updateMeta(thread.id, { status: 'in_progress' });
  }

  return {
    thread: await SupportThread.findById(thread.id),
    message: created,
  };
}

module.exports = {
  getAdminUserProfile,
  listUserFinanceDeposits,
  listUserFinanceWithdrawals,
  listUserDetailCards,
  listUserCardSpendTransactions,
  listUserSupportThreads,
  getUserSupportThreadMessages,
  replyToUserSupport,
  mapUserDetailCard,
};
