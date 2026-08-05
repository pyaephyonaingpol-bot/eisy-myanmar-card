const { getDb } = require('../db');

const SupportThread = {
  async findById(id) {
    const db = getDb();
    return db.get('SELECT * FROM support_threads WHERE id = ?', id);
  },

  async findByUserId(userId) {
    const db = getDb();
    return db.all(
      'SELECT * FROM support_threads WHERE user_id = ? ORDER BY updated_at DESC',
      userId
    );
  },

  async create({ userId, subject, category = 'general', priority = 'normal' }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO support_threads (user_id, subject, category, priority, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `, userId, subject || 'General Support', category, priority);

    return this.findById(result.lastID);
  },

  async updateAfterMessage(threadId, preview, senderType) {
    const db = getDb();
    const unreadUser = senderType === 'admin' ? 'unread_by_user = unread_by_user + 1' : 'unread_by_user = unread_by_user';
    const unreadAdmin = senderType === 'user' ? 'unread_by_admin = unread_by_admin + 1' : 'unread_by_admin = unread_by_admin';

    await db.run(`
      UPDATE support_threads
      SET last_message_at = datetime('now'),
          last_message_preview = ?,
          updated_at = datetime('now'),
          ${unreadUser},
          ${unreadAdmin}
      WHERE id = ?
    `, preview.slice(0, 120), threadId);

    return this.findById(threadId);
  },

  async close(id) {
    const db = getDb();
    await db.run(`
      UPDATE support_threads
      SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, id);
    return this.findById(id);
  },

  async listAll({ status, limit = 100 } = {}) {
    const db = getDb();
    if (status) {
      return db.all(`
        SELECT st.*, u.email, u.name
        FROM support_threads st
        JOIN users u ON u.id = st.user_id
        WHERE st.status = ?
        ORDER BY st.updated_at DESC LIMIT ?
      `, status, limit);
    }
    return db.all(`
      SELECT st.*, u.email, u.name
      FROM support_threads st
      JOIN users u ON u.id = st.user_id
      ORDER BY st.updated_at DESC LIMIT ?
    `, limit);
  },
};

module.exports = SupportThread;
