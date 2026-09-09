const { getDb } = require('../db');

const UsdtInternalTransfer = {
  TABLE: 'usdt_internal_transfers',

  async findByIdempotencyKey(key) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE idempotency_key = ?`, key);
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByUserId(userId, { limit = 50 } = {}) {
    const db = getDb();
    // UNION ALL lets SQLite use the from_user_id / to_user_id indexes instead
    // of a full OR scan — critical for internal transfer history under load.
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    return db.all(
      `SELECT * FROM (
         SELECT * FROM ${this.TABLE} WHERE from_user_id = ?
         UNION ALL
         SELECT * FROM ${this.TABLE} WHERE to_user_id = ?
       )
       ORDER BY created_at DESC
       LIMIT ?`,
      userId,
      userId,
      cap
    );
  },
};

module.exports = UsdtInternalTransfer;
