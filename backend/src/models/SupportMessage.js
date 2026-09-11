const { getDb } = require('../db');
const SupportThread = require('./SupportThread');

const SupportMessage = {
  async findByThreadId(threadId, { limit = 200, beforeId } = {}) {
    const db = getDb();
    if (beforeId) {
      return db.all(`
        SELECT * FROM support_messages
        WHERE thread_id = ? AND id < ?
        ORDER BY created_at DESC LIMIT ?
      `, threadId, beforeId, limit);
    }
    return db.all(`
      SELECT * FROM support_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC LIMIT ?
    `, threadId, limit);
  },

  async create({
    threadId, senderType, senderId, message,
    attachmentPath, attachmentOriginalName, attachmentMimeType,
    source = 'web', telegramMessageId = null, telegramChatId = null,
  }) {
    const db = getDb();
    let result;
    try {
      result = await db.run(`
        INSERT INTO support_messages (
          thread_id, sender_type, sender_id, message,
          attachment_path, attachment_original_name, attachment_mime_type,
          source, telegram_message_id, telegram_chat_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, threadId, senderType, senderId || null, message,
        attachmentPath || null, attachmentOriginalName || null, attachmentMimeType || null,
        source || 'web', telegramMessageId || null, telegramChatId || null);
    } catch (err) {
      // Pre-migration fallback (source / telegram columns not yet present).
      if (!/no such column/i.test(err.message || '')) throw err;
      result = await db.run(`
        INSERT INTO support_messages (
          thread_id, sender_type, sender_id, message,
          attachment_path, attachment_original_name, attachment_mime_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, threadId, senderType, senderId || null, message,
        attachmentPath || null, attachmentOriginalName || null, attachmentMimeType || null);
    }

    await SupportThread.updateAfterMessage(threadId, message, senderType);
    return db.get('SELECT * FROM support_messages WHERE id = ?', result.lastID);
  },

  async markReadByUser(threadId) {
    const db = getDb();
    await db.run(`
      UPDATE support_messages SET read_by_user_at = datetime('now')
      WHERE thread_id = ? AND sender_type != 'user' AND read_by_user_at IS NULL
    `, threadId);
    await db.run('UPDATE support_threads SET unread_by_user = 0 WHERE id = ?', threadId);
  },

  async markReadByAdmin(threadId) {
    const db = getDb();
    await db.run(`
      UPDATE support_messages SET read_by_admin_at = datetime('now')
      WHERE thread_id = ? AND sender_type = 'user' AND read_by_admin_at IS NULL
    `, threadId);
    await db.run('UPDATE support_threads SET unread_by_admin = 0 WHERE id = ?', threadId);
  },
};

module.exports = SupportMessage;
