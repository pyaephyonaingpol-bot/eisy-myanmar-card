const { getDb } = require('../db');

const TransactionLog = {
  async create({
    userId, type, direction = 'neutral', amountUsd, amountMmk,
    balanceBefore, balanceAfter, referenceType, referenceId,
    description, metadata, ipAddress, createdBy = 'system',
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO transaction_logs (
        user_id, type, direction, amount_usd, amount_mmk,
        balance_before, balance_after, reference_type, reference_id,
        description, metadata, ip_address, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      userId, type, direction,
      amountUsd ?? null, amountMmk ?? null,
      balanceBefore ?? null, balanceAfter ?? null,
      referenceType || null, referenceId ?? null,
      description, metadata ? JSON.stringify(metadata) : null,
      ipAddress || null, createdBy
    );

    return db.get('SELECT * FROM transaction_logs WHERE id = ?', result.lastID);
  },

  async findByUserId(userId, { limit = 50, offset = 0, type } = {}) {
    const db = getDb();
    if (type) {
      return db.all(`
        SELECT * FROM transaction_logs
        WHERE user_id = ? AND type = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `, userId, type, limit, offset);
    }
    return db.all(`
      SELECT * FROM transaction_logs
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, userId, limit, offset);
  },

  async findByReference(referenceType, referenceId) {
    const db = getDb();
    return db.all(`
      SELECT * FROM transaction_logs
      WHERE reference_type = ? AND reference_id = ?
      ORDER BY created_at ASC
    `, referenceType, referenceId);
  },

  async listAll({ userId, limit = 100, type } = {}) {
    const db = getDb();
    const clauses = [];
    const params = [];

    if (userId) {
      clauses.push('tl.user_id = ?');
      params.push(userId);
    }
    if (type) {
      clauses.push('tl.type = ?');
      params.push(type);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return db.all(`
      SELECT tl.*, u.email, u.name
      FROM transaction_logs tl
      LEFT JOIN users u ON u.id = tl.user_id
      ${where}
      ORDER BY tl.created_at DESC
      LIMIT ?
    `, ...params, limit);
  },
};

module.exports = TransactionLog;
