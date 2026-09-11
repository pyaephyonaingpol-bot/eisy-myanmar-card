'use strict';

/**
 * Two-way Telegram bridge for unified support live chat + tickets.
 *
 * Outbound: customer ticket / chat → admin Telegram group (reply-threaded).
 * Inbound: admin Telegram reply → support_messages (shown in web live chat).
 */

const { getDb } = require('../db');
const SupportThread = require('../models/SupportThread');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITY_LABELS,
  normalizeSupportCategory,
  normalizeSupportPriority,
  normalizeSupportStatus,
} = require('../constants/supportTasks');
const {
  sendAdminMessage,
  getAdminChatId,
  isTelegramConfigured,
} = require('./telegram');

const THREAD_TAG_RE = /#T(\d+)\b/i;

function supportTopicId() {
  const raw = process.env.TELEGRAM_SUPPORT_TOPIC_ID || process.env.TELEGRAM_FORUM_TOPIC_ID || '';
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatCategory(category) {
  const key = normalizeSupportCategory(category);
  return SUPPORT_CATEGORIES[key] || key || 'Support';
}

function formatPriority(priority) {
  const key = normalizeSupportPriority(priority);
  return SUPPORT_PRIORITY_LABELS[key] || key || 'Medium';
}

function formatStatus(status) {
  const key = normalizeSupportStatus(status);
  if (key === 'pending') return 'Open';
  if (key === 'in_progress') return 'In Progress';
  if (key === 'completed') return 'Resolved';
  if (key === 'failed') return 'Failed';
  return key;
}

function escapeMd(value) {
  return String(value || '')
    .replace(/([_*`\[])/g, '\\$1')
    .slice(0, 3500);
}

function extractThreadIdFromText(text) {
  const m = String(text || '').match(THREAD_TAG_RE);
  return m ? parseInt(m[1], 10) : null;
}

async function persistTelegramLink(threadId, { chatId, rootMessageId, lastOutboundId } = {}) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (chatId != null) {
    sets.push('telegram_chat_id = ?');
    params.push(String(chatId));
  }
  if (rootMessageId != null) {
    sets.push('telegram_root_message_id = ?');
    params.push(Number(rootMessageId));
  }
  if (lastOutboundId != null) {
    sets.push('telegram_last_outbound_id = ?');
    params.push(Number(lastOutboundId));
  }
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  params.push(threadId);
  await db.run(`UPDATE support_threads SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

async function attachTelegramMetaToMessage(messageId, { chatId, telegramMessageId, source } = {}) {
  if (!messageId) return;
  const db = getDb();
  await db.run(
    `UPDATE support_messages
     SET telegram_chat_id = COALESCE(?, telegram_chat_id),
         telegram_message_id = COALESCE(?, telegram_message_id),
         source = COALESCE(?, source)
     WHERE id = ?`,
    chatId != null ? String(chatId) : null,
    telegramMessageId != null ? Number(telegramMessageId) : null,
    source || null,
    messageId
  );
}

function buildTicketBanner(thread, user) {
  return [
    '🎫 *New Support Ticket*',
    '',
    `🔖 Ticket: \`#T${thread.id}\``,
    `📂 Category: *${escapeMd(formatCategory(thread.category))}*`,
    `⚡ Priority: *${escapeMd(formatPriority(thread.priority))}*`,
    `📌 Status: *${escapeMd(formatStatus(thread.status))}*`,
    `📝 Subject: ${escapeMd(thread.subject || 'Support request')}`,
    `👤 User: ${escapeMd(user?.name || 'Unknown')} (${escapeMd(user?.email || user?.phone || 'N/A')})`,
    '',
    '_Reply to this message in Telegram to answer the customer in live chat._',
  ].join('\n');
}

/**
 * Notify Telegram about a new ticket or a new web chat message.
 * Safe to fire-and-forget — never throws to HTTP handlers.
 */
async function notifySupportEvent({
  thread,
  message,
  user = null,
  isNewTicket = false,
} = {}) {
  try {
    if (!isTelegramConfigured()) return { skipped: true };
    if (!thread?.id || !message?.message) return { skipped: true };
    if (String(message.source || '') === 'telegram') {
      return { skipped: true, reason: 'telegram_source' };
    }

    let account = user;
    if (!account && thread.user_id) {
      try { account = await User.findById(thread.user_id); } catch (_) { /* ignore */ }
    }

    const topicId = supportTopicId();
    const fresh = await SupportThread.findById(thread.id) || thread;
    const replyTo = fresh.telegram_root_message_id || fresh.telegram_last_outbound_id || null;

    let text;
    if (isNewTicket || !replyTo) {
      text = [buildTicketBanner(fresh, account), '', escapeMd(message.message)].join('\n');
    } else {
      const who = message.sender_type === 'admin' ? '🛠️ Admin (web)' : '👤 Customer';
      text = [`${who} · \`#T${fresh.id}\``, escapeMd(message.message)].join('\n');
    }

    const result = await sendAdminMessage(text, {
      replyToMessageId: isNewTicket ? null : replyTo,
      messageThreadId: topicId,
    });
    if (!result?.ok || !result.message) return result || { ok: false };

    const tgMsgId = result.message.message_id;
    const tgChatId = result.chatId || getAdminChatId();

    if (isNewTicket || !fresh.telegram_root_message_id) {
      await persistTelegramLink(fresh.id, {
        chatId: tgChatId,
        rootMessageId: tgMsgId,
        lastOutboundId: tgMsgId,
      });
    } else {
      await persistTelegramLink(fresh.id, {
        chatId: tgChatId,
        lastOutboundId: tgMsgId,
      });
    }

    await attachTelegramMetaToMessage(message.id, {
      chatId: tgChatId,
      telegramMessageId: tgMsgId,
      source: message.sender_type === 'admin' ? 'admin' : 'web',
    });

    try {
      const updated = await SupportThread.findById(fresh.id);
      const sync = require('./supabaseSyncService');
      await sync.syncSupportThread?.(updated, account);
      await sync.syncSupportMessage?.(message, updated);
    } catch (_) { /* optional */ }

    return { ok: true, telegramMessageId: tgMsgId };
  } catch (err) {
    console.error('[support/telegram] notify failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function findThreadForTelegramReply(msg) {
  const db = getDb();
  const chatId = String(msg.chat?.id || '');
  const reply = msg.reply_to_message;

  if (reply?.message_id) {
    const byThread = await db.get(
      `SELECT * FROM support_threads
       WHERE telegram_chat_id = ?
         AND (telegram_root_message_id = ? OR telegram_last_outbound_id = ?)
       ORDER BY updated_at DESC LIMIT 1`,
      chatId,
      reply.message_id,
      reply.message_id
    );
    if (byThread) return byThread;

    const byMessage = await db.get(
      `SELECT st.* FROM support_messages sm
       JOIN support_threads st ON st.id = sm.thread_id
       WHERE sm.telegram_chat_id = ? AND sm.telegram_message_id = ?
       LIMIT 1`,
      chatId,
      reply.message_id
    );
    if (byMessage) return byMessage;

    const fromReplyText = extractThreadIdFromText(reply.text || reply.caption || '');
    if (fromReplyText) {
      const t = await SupportThread.findById(fromReplyText);
      if (t) return t;
    }
  }

  const fromBody = extractThreadIdFromText(msg.text || msg.caption || '');
  if (fromBody) return SupportThread.findById(fromBody);
  return null;
}

function isFromAdminChat(msg) {
  const adminChat = getAdminChatId();
  if (!adminChat) return false;
  return String(msg.chat?.id || '') === String(adminChat);
}

async function ingestAdminTelegramReply({ threadId, text, msg, thread = null }) {
  const db = getDb();
  const existing = await db.get(
    `SELECT id FROM support_messages
     WHERE telegram_chat_id = ? AND telegram_message_id = ?
     LIMIT 1`,
    String(msg.chat.id),
    Number(msg.message_id)
  );
  if (existing) return { ok: true, duplicate: true, messageId: existing.id };

  const current = thread || await SupportThread.findById(threadId);
  if (!current) return { ok: false, error: 'thread_not_found' };
  if (['completed', 'closed', 'failed'].includes(String(current.status))) {
    await sendAdminMessage(
      `ℹ️ Ticket \`#T${current.id}\` is already *${formatStatus(current.status)}*. Re-open it in Admin if you need to continue.`,
      { replyToMessageId: msg.message_id }
    );
    return { ok: false, error: 'thread_closed' };
  }

  const message = await SupportMessage.create({
    threadId: current.id,
    senderType: 'admin',
    senderId: msg.from?.id != null ? Number(msg.from.id) : null,
    message: text,
    source: 'telegram',
    telegramMessageId: msg.message_id,
    telegramChatId: String(msg.chat.id),
  });

  if (current.status === 'pending' || current.status === 'open') {
    await SupportThread.updateMeta(current.id, { status: 'in_progress' });
  }

  await persistTelegramLink(current.id, {
    chatId: String(msg.chat.id),
    rootMessageId: current.telegram_root_message_id || msg.reply_to_message?.message_id || null,
    lastOutboundId: msg.message_id,
  });

  try {
    const sync = require('./supabaseSyncService');
    const updated = await SupportThread.findById(current.id);
    await sync.syncSupportThread?.(updated);
    await sync.syncSupportMessage?.(message, updated);
  } catch (_) { /* optional */ }

  console.log(`[support/telegram] synced admin reply → #T${current.id} msg ${message.id}`);
  return { ok: true, threadId: current.id, messageId: message.id };
}

/**
 * Handle an inbound Telegram Bot API update (webhook).
 */
async function handleTelegramUpdate(update) {
  const msg = update?.message || update?.edited_message;
  if (!msg) return { ignored: true, reason: 'no_message' };
  if (!isTelegramConfigured()) return { ignored: true, reason: 'not_configured' };
  if (!isFromAdminChat(msg)) return { ignored: true, reason: 'wrong_chat' };
  if (msg.from?.is_bot) return { ignored: true, reason: 'bot_message' };

  const text = String(msg.text || msg.caption || '').trim();
  if (!text) return { ignored: true, reason: 'empty' };

  if (text.startsWith('/')) {
    const cmdMatch = text.match(/^\/reply(?:@\w+)?\s+#T(\d+)\s+([\s\S]+)/i);
    if (!cmdMatch) return { ignored: true, reason: 'command' };
    return ingestAdminTelegramReply({
      threadId: parseInt(cmdMatch[1], 10),
      text: cmdMatch[2].trim(),
      msg,
    });
  }

  const thread = await findThreadForTelegramReply(msg);
  if (!thread) {
    if (msg.reply_to_message) {
      await sendAdminMessage(
        '⚠️ Could not map that reply to a support ticket. Reply directly to a `#T123` ticket message, or use `/reply #T123 your message`.',
        { replyToMessageId: msg.message_id }
      );
    }
    return { ignored: true, reason: 'thread_not_found' };
  }

  return ingestAdminTelegramReply({
    threadId: thread.id,
    text,
    msg,
    thread,
  });
}

module.exports = {
  notifySupportEvent,
  handleTelegramUpdate,
  formatCategory,
  formatPriority,
  formatStatus,
  extractThreadIdFromText,
  isTelegramConfigured,
};
