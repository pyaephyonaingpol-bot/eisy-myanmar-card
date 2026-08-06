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
    return db.all(
      `SELECT * FROM ${this.TABLE}
       WHERE from_user_id = ? OR to_user_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      userId,
      userId,
      limit
    );
  },
};

module.exports = UsdtInternalTransfer;
