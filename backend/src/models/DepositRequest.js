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
    platformProfitUsd = 0,
  }) {
    const db = getDb();
    const currency = depositCurrency || 'USDT';
    const network = usdtNetwork || null;

    if (currency !== 'USDT') {
      const err = new Error('Deposits accept USDT/crypto only. MMK bank deposits are no longer supported.');
      err.code = 'USDT_ONLY_DEPOSIT';
      throw err;
    }
    if (Number(amountMmk) > 0) {
      const err = new Error('MMK amounts are not accepted for deposits.');
      err.code = 'USDT_ONLY_DEPOSIT';
      throw err;
    }

    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, amount_mmk, amount_usd, ref_code, payment_method,
        deposit_currency, usdt_network, platform_profit_usd,
        status, expires_at, purpose, metadata, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, datetime('now'))
    `, userId, amountMmk ?? 0, amountUsd, refCode, paymentMethod,
      currency, network, platformProfitUsd ?? 0, expiresAt || null,
      purpose, metadata ? JSON.stringify(metadata) : null);

    const row = await this.findById(result.lastID);
    await this._syncDepositSafe(row);
    return row;
  },

  async submitProof(id, {
    kpayTransactionId, txnId, txHash, screenshotPath,
    screenshotOriginalName, screenshotMimeType, userNote,
  }) {
    const db = getDb();
    const hash = txHash || txnId || kpayTransactionId || null;
    try {
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
    } catch (err) {
      if (/UNIQUE|constraint/i.test(err.message || '')) {
        const reuse = new Error('This TxHash / transaction ID has already been used');
        reuse.code = 'TX_HASH_REUSED';
        throw reuse;
      }
      throw err;
    }

    const row = await this.findById(id);
    await this._syncDepositSafe(row);
    return row;
  },

  async review(id, { status, adminNote, rejectionReason, reviewedByAdminId, skipSync = false }) {
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
    // Skip sync when called inside an open SQL transaction — caller syncs after COMMIT
    if (!skipSync) await this._syncDepositSafe(row);
    return row;
  },

  /**
   * Atomically claim a deposit for credit. Returns true only if this caller
   * transitioned the row out of a non-terminal status (prevents double-credit).
   */
  async claimForCredit(id, {
    adminNote,
    reviewedByAdminId,
    txnId,
    txHash,
  } = {}) {
    const db = getDb();
    const hash = (txHash || txnId || null) ? String(txHash || txnId).trim() || null : null;
    const result = await db.run(`
      UPDATE ${this.TABLE}
      SET status = 'VERIFIED',
          admin_note = COALESCE(?, admin_note),
          reviewed_by_admin_id = COALESCE(?, reviewed_by_admin_id),
          reviewed_at = datetime('now'),
          verified_at = datetime('now'),
          updated_at = datetime('now'),
          txn_id = COALESCE(?, txn_id),
          tx_hash = COALESCE(?, tx_hash),
          kpay_transaction_id = COALESCE(?, kpay_transaction_id)
      WHERE id = ?
        AND status NOT IN ('VERIFIED', 'REJECTED', 'FAILED')
    `, adminNote || null, reviewedByAdminId || null, hash, hash, hash, id);

    return Number(result?.changes || 0) === 1;
  },

  async _syncDepositSafe(row) {
    if (!row) return;
    try {
      await syncDeposit(row);
    } catch (err) {
      console.warn('[supabase] deposit sync:', err.message);
    }
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
