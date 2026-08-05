const { getDb } = require('../db');

const P2PBuyOrder = {
  TABLE: 'p2p_buy_orders',

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
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? OR maker_user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId, userId, limit
    );
  },

  async listByStatus(status, { limit = 100 } = {}) {
    const db = getDb();
    if (status) {
      return db.all(
        `SELECT * FROM ${this.TABLE} WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        status, limit
      );
    }
    return db.all(
      `SELECT * FROM ${this.TABLE} ORDER BY created_at DESC LIMIT ?`,
      limit
    );
  },

  async create({
    userId,
    sellerId,
    adId,
    makerUserId,
    refCode,
    amountUsdt,
    amountMmk,
    priceMmkPerUsdt,
    paymentMethod,
    metadata,
    expiresAt,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
        price_mmk_per_usdt, payment_method, status, metadata, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, datetime('now'))
    `,
      userId,
      sellerId || null,
      adId || null,
      makerUserId || null,
      refCode,
      amountUsdt,
      amountMmk,
      priceMmkPerUsdt,
      paymentMethod,
      metadata ? JSON.stringify(metadata) : null,
      expiresAt || null
    );
    return this.findById(result.lastID);
  },

  async updateStatus(id, status, extra = {}) {
    const db = getDb();
    const sets = ['status = ?', "updated_at = datetime('now')"];
    const params = [status];

    if (status === 'pending_seller_release' && extra.mmkTransferredAt !== false) {
      sets.push("mmk_transferred_at = COALESCE(mmk_transferred_at, datetime('now'))");
    }
    if (status === 'released' || status === 'completed_by_admin') {
      sets.push("released_at = datetime('now')");
    }
    if (status === 'rejected' || status === 'cancelled_by_admin') {
      sets.push("rejected_at = datetime('now')");
    }
    if (extra.adminNote != null) {
      sets.push('admin_note = ?');
      params.push(extra.adminNote);
    }
    if (extra.platformFeeUsdt != null) {
      sets.push('platform_fee_usdt = ?');
      params.push(extra.platformFeeUsdt);
    }
    if (extra.netUsdtToBuyer != null) {
      sets.push('net_usdt_to_buyer = ?');
      params.push(extra.netUsdtToBuyer);
    }
    if (extra.feePercentApplied != null) {
      sets.push('fee_percent_applied = ?');
      params.push(extra.feePercentApplied);
    }

    params.push(id);
    await db.run(
      `UPDATE ${this.TABLE} SET ${sets.join(', ')} WHERE id = ?`,
      ...params
    );
    return this.findById(id);
  },

  async savePaymentProof(id, { proofPath, originalName, mimeType, txRef } = {}) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET payment_proof_path = ?,
          payment_proof_original_name = ?,
          payment_proof_mime_type = ?,
          payment_tx_ref = COALESCE(?, payment_tx_ref),
          updated_at = datetime('now')
      WHERE id = ?
    `, proofPath || null, originalName || null, mimeType || null, txRef || null, id);
    return this.findById(id);
  },

  mapForClient(row, { seller, user } = {}) {
    if (!row) return null;
    let metadata = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch (_) { /* ignore */ }

    return {
      id: row.id,
      user_id: row.user_id,
      seller_id: row.seller_id,
      ad_id: row.ad_id != null ? Number(row.ad_id) : null,
      maker_user_id: row.maker_user_id != null ? Number(row.maker_user_id) : null,
      ref_code: row.ref_code,
      amount_usdt: Number(row.amount_usdt),
      amount_mmk: Number(row.amount_mmk),
      price_mmk_per_usdt: Number(row.price_mmk_per_usdt),
      payment_method: row.payment_method,
      status: row.status,
      mmk_transferred_at: row.mmk_transferred_at,
      released_at: row.released_at,
      rejected_at: row.rejected_at,
      admin_note: row.admin_note,
      platform_fee_usdt: row.platform_fee_usdt != null ? Number(row.platform_fee_usdt) : null,
      net_usdt_to_buyer: row.net_usdt_to_buyer != null ? Number(row.net_usdt_to_buyer) : null,
      fee_percent_applied: row.fee_percent_applied != null ? Number(row.fee_percent_applied) : null,
      expires_at: row.expires_at,
      dispute_status: row.dispute_status || null,
      dispute_reason: row.dispute_reason || null,
      dispute_proof_path: row.dispute_proof_path || null,
      payment_tx_ref: row.payment_tx_ref || null,
      payment_proof_path: row.payment_proof_path || null,
      payment_proof_url: row.payment_proof_path || null,
      paymentProofUrl: row.payment_proof_path || null,
      payment_proof_original_name: row.payment_proof_original_name || null,
      payment_proof_mime_type: row.payment_proof_mime_type || null,
      disputed_at: row.disputed_at,
      auto_cancelled_at: row.auto_cancelled_at,
      is_disputed: row.dispute_status === 'open',
      metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_name: seller?.name || metadata.seller_name || null,
      user_name: user?.name || null,
      user_email: user?.email || null,
    };
  },
};

module.exports = P2PBuyOrder;
