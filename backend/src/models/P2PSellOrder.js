const { getDb } = require('../db');

const P2PSellOrder = {
  TABLE: 'p2p_sell_orders',

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
    userPaymentAccount,
    metadata,
    expiresAt,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, seller_id, ad_id, maker_user_id, ref_code, amount_usdt, amount_mmk,
        price_mmk_per_usdt, payment_method, user_payment_account,
        status, usdt_escrowed_at, metadata, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_merchant_mmk', datetime('now'), ?, ?, datetime('now'))
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
      JSON.stringify(userPaymentAccount),
      metadata ? JSON.stringify(metadata) : null,
      expiresAt || null
    );
    return this.findById(result.lastID);
  },

  async updateStatus(id, status, extra = {}) {
    const db = getDb();
    const sets = ['status = ?', "updated_at = datetime('now')"];
    const params = [status];

    if (status === 'released' || status === 'completed_by_admin') {
      sets.push("released_at = datetime('now')");
      if (extra.mmkReceivedAt !== false) {
        sets.push("mmk_received_at = COALESCE(mmk_received_at, datetime('now'))");
      }
    }
    if (status === 'rejected') {
      sets.push("rejected_at = datetime('now')");
    }
    if (status === 'cancelled' || status === 'cancelled_by_admin') {
      sets.push("cancelled_at = datetime('now')");
    }
    if (extra.adminNote != null) {
      sets.push('admin_note = ?');
      params.push(extra.adminNote);
    }
    if (extra.platformFeeUsdt != null) {
      sets.push('platform_fee_usdt = ?');
      params.push(extra.platformFeeUsdt);
    }
    if (extra.netUsdtToMerchant != null) {
      sets.push('net_usdt_to_merchant = ?');
      params.push(extra.netUsdtToMerchant);
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

  mapForClient(row, { seller, user } = {}) {
    if (!row) return null;
    let metadata = {};
    let userPaymentAccount = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch (_) { /* ignore */ }
    try {
      userPaymentAccount = row.user_payment_account ? JSON.parse(row.user_payment_account) : {};
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
      user_payment_account: userPaymentAccount,
      status: row.status,
      usdt_escrowed_at: row.usdt_escrowed_at,
      mmk_received_at: row.mmk_received_at,
      released_at: row.released_at,
      rejected_at: row.rejected_at,
      cancelled_at: row.cancelled_at,
      platform_fee_usdt: row.platform_fee_usdt != null ? Number(row.platform_fee_usdt) : null,
      net_usdt_to_merchant: row.net_usdt_to_merchant != null ? Number(row.net_usdt_to_merchant) : null,
      fee_percent_applied: row.fee_percent_applied != null ? Number(row.fee_percent_applied) : null,
      admin_note: row.admin_note,
      expires_at: row.expires_at,
      dispute_status: row.dispute_status || null,
      dispute_reason: row.dispute_reason || null,
      dispute_proof_path: row.dispute_proof_path || null,
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

module.exports = P2PSellOrder;
