const { getDb } = require('../db');
const {
  normalizeSupportCategory,
  normalizeSupportPriority,
  normalizeSupportStatus,
} = require('../constants/supportTasks');

function syncSupportThreadToSupabase(thread, user = null) {
  try {
    const { syncSupportThread } = require('../services/supabaseSyncService');
    syncSupportThread(thread, user).catch((err) => {
      console.warn('[support] supabase mirror skipped:', err.message);
    });
  } catch (err) {
    console.warn('[support] supabase mirror unavailable:', err.message);
  }
}

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

  async create({
    userId,
    subject,
    category = 'general',
    priority = 'medium',
    status = 'pending',
  }) {
    const db = getDb();
    const cat = normalizeSupportCategory(category);
    const pri = normalizeSupportPriority(priority);
    const st = normalizeSupportStatus(status);
    const result = await db.run(`
      INSERT INTO support_threads (user_id, subject, category, priority, status, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, userId, subject || 'Support request', cat, pri, st);

    const thread = await this.findById(result.lastID);
    let user = null;
    try {
      const User = require('./User');
      user = await User.findById(userId);
    } catch (_) { /* ignore */ }
    syncSupportThreadToSupabase(thread, user);
    return thread;
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
    `, String(preview || '').slice(0, 120), threadId);

    const thread = await this.findById(threadId);
    syncSupportThreadToSupabase(thread);
    return thread;
  },

  async updateMeta(id, {
    status,
    priority,
    category,
    assignedAdminId,
  } = {}) {
    const db = getDb();
    const current = await this.findById(id);
    if (!current) return null;

    const nextStatus = status != null ? normalizeSupportStatus(status) : current.status;
    const nextPriority = priority != null ? normalizeSupportPriority(priority) : current.priority;
    const nextCategory = category != null ? normalizeSupportCategory(category) : current.category;
    const nextAssignee = assignedAdminId !== undefined
      ? (assignedAdminId == null ? null : parseInt(assignedAdminId, 10))
      : current.assigned_admin_id;

    const closedAtSql = (nextStatus === 'completed' || nextStatus === 'failed')
      ? "closed_at = COALESCE(closed_at, datetime('now'))"
      : 'closed_at = NULL';

    await db.run(`
      UPDATE support_threads
      SET status = ?,
          priority = ?,
          category = ?,
          assigned_admin_id = ?,
          updated_at = datetime('now'),
          ${closedAtSql}
      WHERE id = ?
    `, nextStatus, nextPriority, nextCategory, nextAssignee, id);

    const thread = await this.findById(id);
    syncSupportThreadToSupabase(thread);
    return thread;
  },

  async close(id) {
    return this.updateMeta(id, { status: 'completed' });
  },

  async listAll({
    status = null,
    category = null,
    priority = null,
    limit = 100,
  } = {}) {
    const db = getDb();
    const where = [];
    const params = [];

    if (status && status !== 'all') {
      const st = normalizeSupportStatus(status);
      where.push('st.status = ?');
      params.push(st);
    }
    if (category && category !== 'all') {
      where.push('st.category = ?');
      params.push(normalizeSupportCategory(category));
    }
    if (priority && priority !== 'all') {
      where.push('st.priority = ?');
      params.push(normalizeSupportPriority(priority));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Math.max(1, Math.min(500, Number(limit) || 100)));

    return db.all(`
      SELECT st.*, u.email, u.name
      FROM support_threads st
      JOIN users u ON u.id = st.user_id
      ${whereSql}
      ORDER BY
        CASE st.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        CASE st.status
          WHEN 'pending' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'failed' THEN 2
          ELSE 3
        END,
        st.updated_at DESC
      LIMIT ?
    `, ...params);
  },
};

module.exports = SupportThread;
