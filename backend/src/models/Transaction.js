/**
 * Transaction model (SQLite / LibSQL)
 *
 * Fields: id, userId, type ('deposit'|'withdraw'), amount, currency ('USDT'),
 *         status ('pending'|'completed'|'rejected'), txId (optional), createdAt
 */

const { getDb } = require('../db');

const TRANSACTION_TYPES = ['deposit', 'withdraw'];
const TRANSACTION_STATUSES = ['pending', 'completed', 'rejected'];
const DEFAULT_CURRENCY = 'USDT';

const Transaction = {
  TABLE: 'transactions',
  TYPES: TRANSACTION_TYPES,
  STATUSES: TRANSACTION_STATUSES,
  DEFAULT_CURRENCY,

  /** Map DB row → API shape (camelCase). */
  toPublic(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      txId: row.tx_id ?? null,
      createdAt: row.created_at,
    };
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByTxId(txId) {
    const db = getDb();
    const normalized = String(txId || '').trim();
    if (!normalized) return null;
    return db.get(`SELECT * FROM ${this.TABLE} WHERE tx_id = ?`, normalized);
  },

  async findByUserId(userId, { type, status, limit = 50 } = {}) {
    const db = getDb();
    const clauses = ['user_id = ?'];
    const params = [userId];

    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    params.push(limit);

    return db.all(
      `SELECT * FROM ${this.TABLE}
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ...params
    );
  },

  async create({
    userId,
    type,
    amount,
    currency = DEFAULT_CURRENCY,
    status = 'pending',
    txId = null,
  }) {
    if (!TRANSACTION_TYPES.includes(type)) {
      throw new Error(`Invalid transaction type: ${type}`);
    }
    if (!TRANSACTION_STATUSES.includes(status)) {
      throw new Error(`Invalid transaction status: ${status}`);
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error('amount must be a positive number');
    }
    const cur = String(currency || DEFAULT_CURRENCY).toUpperCase();
    if (cur !== 'USDT') {
      throw new Error('currency must be USDT');
    }

    const db = getDb();
    const result = await db.run(
      `INSERT INTO ${this.TABLE}
        (user_id, type, amount, currency, status, tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      userId,
      type,
      amt,
      cur,
      status,
      txId ? String(txId).trim() : null
    );
    return this.findById(result.lastID);
  },

  async updateStatus(id, { status, txId } = {}) {
    if (status && !TRANSACTION_STATUSES.includes(status)) {
      throw new Error(`Invalid transaction status: ${status}`);
    }
    const db = getDb();
    await db.run(
      `UPDATE ${this.TABLE}
       SET status = COALESCE(?, status),
           tx_id = COALESCE(?, tx_id)
       WHERE id = ?`,
      status || null,
      txId != null ? String(txId).trim() : null,
      id
    );
    return this.findById(id);
  },

  async listAll({ type, status, limit = 200 } = {}) {
    const db = getDb();
    const clauses = [];
    const params = [];

    if (type) {
      clauses.push('t.type = ?');
      params.push(type);
    }
    if (status) {
      clauses.push('t.status = ?');
      params.push(status);
    }
    params.push(limit);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.all(
      `SELECT t.*, u.email AS user_email, u.username AS user_username, u.name AS user_name
       FROM ${this.TABLE} t
       JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT ?`,
      ...params
    );
  },
};

module.exports = Transaction;
