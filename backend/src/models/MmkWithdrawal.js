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

  async updateStatus(id, {
    status,
    adminNote,
    processedBy,
    proofPath,
    proofUrl,
    proofMimeType,
    proofOriginalName,
    proofUploadedAt,
    proofUploadedBy,
  } = {}) {
    const db = getDb();
    const processedAt = ['completed', 'rejected', 'cancelled'].includes(status)
      ? ", processed_at = datetime('now')"
      : '';

    const proofSets = [];
    const proofParams = [];
    if (proofPath !== undefined) {
      proofSets.push('proof_path = ?');
      proofParams.push(proofPath || null);
    }
    if (proofUrl !== undefined) {
      proofSets.push('proof_url = ?');
      proofParams.push(proofUrl || null);
    }
    if (proofMimeType !== undefined) {
      proofSets.push('proof_mime_type = ?');
      proofParams.push(proofMimeType || null);
    }
    if (proofOriginalName !== undefined) {
      proofSets.push('proof_original_name = ?');
      proofParams.push(proofOriginalName || null);
    }
    if (proofUploadedAt !== undefined) {
      proofSets.push('proof_uploaded_at = ?');
      proofParams.push(proofUploadedAt || null);
    }
    if (proofUploadedBy !== undefined) {
      proofSets.push('proof_uploaded_by = ?');
      proofParams.push(proofUploadedBy ?? null);
    }
    const proofSql = proofSets.length ? `, ${proofSets.join(', ')}` : '';

    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          processed_by = COALESCE(?, processed_by),
          updated_at = datetime('now')
          ${processedAt}
          ${proofSql}
      WHERE id = ?
    `, status, adminNote || null, processedBy ?? null, ...proofParams, id);
    return this.findById(id);
  },

  async listAll({ status, limit = 200 } = {}) {
    const db = getDb();
    const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const normalized = status == null || status === '' || status === 'all'
      ? null
      : String(status).trim().toLowerCase();

    if (normalized === 'open') {
      return db.all(`
        SELECT w.*,
               u.name AS user_name,
               u.email AS user_email,
               u.phone AS user_phone,
               u.balance_mmk AS user_balance_mmk
        FROM ${this.TABLE} w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE LOWER(w.status) IN ('pending', 'processing')
        ORDER BY w.created_at DESC
        LIMIT ?
      `, lim);
    }

    if (normalized) {
      return db.all(`
        SELECT w.*,
               u.name AS user_name,
               u.email AS user_email,
               u.phone AS user_phone,
               u.balance_mmk AS user_balance_mmk
        FROM ${this.TABLE} w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE LOWER(w.status) = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `, normalized, lim);
    }

    return db.all(`
      SELECT w.*,
             u.name AS user_name,
             u.email AS user_email,
             u.phone AS user_phone,
             u.balance_mmk AS user_balance_mmk
      FROM ${this.TABLE} w
      LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
      LIMIT ?
    `, lim);
  },
};

module.exports = MmkWithdrawal;
