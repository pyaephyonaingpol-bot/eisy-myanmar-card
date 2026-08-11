const { getDb } = require('../db');

const MmkWithdrawal = {
  TABLE: 'mmk_withdrawal_requests',

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
    amountMmk,
    feeMmk,
    netMmk,
    feePercent = 0,
    bankName,
    accountName,
    accountNumber,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, ref_code, amount_mmk, fee_mmk, net_mmk, fee_percent,
        bank_name, account_name, account_number,
        status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `, userId, refCode, amountMmk, feeMmk, netMmk, feePercent,
    bankName, accountName, accountNumber);
    return this.findById(result.lastID);
  },

  async updateStatus(id, { status, adminNote, processedBy } = {}) {
    const db = getDb();
    const processedAt = ['completed', 'rejected', 'cancelled'].includes(status)
      ? ", processed_at = datetime('now')"
      : '';
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          processed_by = COALESCE(?, processed_by),
          updated_at = datetime('now')
          ${processedAt}
      WHERE id = ?
    `, status, adminNote || null, processedBy ?? null, id);
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

module.exports = MmkWithdrawal;
