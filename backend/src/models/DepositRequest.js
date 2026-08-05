const { getDb } = require('../db');
const { syncDeposit } = require('../services/supabaseSyncService');

const DepositRequest = {
  TABLE: 'deposit_requests_v2',

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
      userId, limit
    );
  },

  async create({
    userId, amountMmk, amountUsd, refCode,
    paymentMethod = 'KBZPay', expiresAt,
    purpose = 'topup', metadata,
    depositCurrency = null,
    usdtNetwork = null,
  }) {
    const db = getDb();
    const currency = depositCurrency
      || (purpose === 'usdt_topup' || String(paymentMethod).startsWith('USDT') ? 'USDT' : 'MMK');
    const network = usdtNetwork || null;

    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, amount_mmk, amount_usd, ref_code, payment_method,
        deposit_currency, usdt_network,
        status, expires_at, purpose, metadata, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, datetime('now'))
    `, userId, amountMmk ?? 0, amountUsd, refCode, paymentMethod,
      currency, network, expiresAt || null,
      purpose, metadata ? JSON.stringify(metadata) : null);

    const row = await this.findById(result.lastID);
    syncDeposit(row).catch((err) => console.warn('[supabase] deposit sync:', err.message));
    return row;
  },

  async submitProof(id, {
    kpayTransactionId, txnId, txHash, screenshotPath,
    screenshotOriginalName, screenshotMimeType, userNote,
  }) {
    const db = getDb();
    const hash = txHash || txnId || kpayTransactionId || null;
    await db.run(`
      UPDATE ${this.TABLE}
      SET kpay_transaction_id = COALESCE(?, kpay_transaction_id),
          txn_id = COALESCE(?, txn_id),
          tx_hash = COALESCE(?, tx_hash),
          screenshot_path = COALESCE(?, screenshot_path),
          screenshot_original_name = COALESCE(?, screenshot_original_name),
          screenshot_mime_type = COALESCE(?, screenshot_mime_type),
          user_note = COALESCE(?, user_note),
          status = 'SUBMITTED',
          submitted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, kpayTransactionId || hash, txnId || hash, hash,
      screenshotPath || null, screenshotOriginalName || null,
      screenshotMimeType || null, userNote || null, id);

    const row = await this.findById(id);
    syncDeposit(row).catch((err) => console.warn('[supabase] deposit sync:', err.message));
    return row;
  },

  async review(id, { status, adminNote, rejectionReason, reviewedByAdminId }) {
    const db = getDb();
    const verifiedAt = status === 'VERIFIED' ? ", verified_at = datetime('now')" : '';

    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          rejection_reason = ?,
          reviewed_by_admin_id = ?,
          reviewed_at = datetime('now'),
          updated_at = datetime('now')${verifiedAt}
      WHERE id = ?
    `, status, adminNote || null, rejectionReason || null, reviewedByAdminId || null, id);

    const row = await this.findById(id);
    syncDeposit(row).catch((err) => console.warn('[supabase] deposit sync:', err.message));
    return row;
  },

  async listPendingReview() {
    const db = getDb();
    return db.all(`
      SELECT dr.*, u.email, u.name, u.phone
      FROM ${this.TABLE} dr
      JOIN users u ON u.id = dr.user_id
      WHERE dr.status IN ('SUBMITTED', 'UNDER_REVIEW', 'PENDING')
      ORDER BY
        CASE dr.status
          WHEN 'SUBMITTED' THEN 0
          WHEN 'UNDER_REVIEW' THEN 1
          ELSE 2
        END,
        dr.submitted_at ASC,
        dr.created_at ASC
    `);
  },

  async listAll({ status, limit = 100 } = {}) {
    const db = getDb();
    if (status) {
      return db.all(`
        SELECT dr.*, u.email, u.name, u.phone
        FROM ${this.TABLE} dr
        JOIN users u ON u.id = dr.user_id
        WHERE dr.status = ?
        ORDER BY dr.created_at DESC LIMIT ?
      `, status, limit);
    }
    return db.all(`
      SELECT dr.*, u.email, u.name, u.phone
      FROM ${this.TABLE} dr
      JOIN users u ON u.id = dr.user_id
      ORDER BY dr.created_at DESC LIMIT ?
    `, limit);
  },
};

module.exports = DepositRequest;
