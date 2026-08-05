const { getDb } = require('../db');

const UsdtWithdrawal = {
  TABLE: 'usdt_withdrawal_requests',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByRefCode(refCode) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE ref_code = ?`, refCode);
  },

  async findByUserId(userId, { limit = 50 } = {}) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      limit
    );
  },

  async create({
    userId,
    refCode,
    network,
    walletAddress,
    amountUsdt,
    feeUsdt,
    netUsdt,
    feeType = 'fixed',
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, ref_code, network, wallet_address,
        amount_usdt, fee_usdt, net_usdt, fee_type,
        status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `, userId, refCode, network, walletAddress, amountUsdt, feeUsdt, netUsdt, feeType);
    return this.findById(result.lastID);
  },

  async updateStatus(id, { status, adminNote, txHash } = {}) {
    const db = getDb();
    const processedAt = ['completed', 'rejected', 'cancelled'].includes(status)
      ? ", processed_at = datetime('now')"
      : '';
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          tx_hash = COALESCE(?, tx_hash),
          updated_at = datetime('now')
          ${processedAt}
      WHERE id = ?
    `, status, adminNote || null, txHash || null, id);
    return this.findById(id);
  },

  async listAll({ status, limit = 200 } = {}) {
    const db = getDb();
    if (status) {
      return db.all(`
        SELECT w.*, u.name AS user_name, u.email AS user_email
        FROM ${this.TABLE} w
        JOIN users u ON u.id = w.user_id
        WHERE w.status = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `, status, limit);
    }
    return db.all(`
      SELECT w.*, u.name AS user_name, u.email AS user_email
      FROM ${this.TABLE} w
      JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
      LIMIT ?
    `, limit);
  },
};

module.exports = UsdtWithdrawal;
