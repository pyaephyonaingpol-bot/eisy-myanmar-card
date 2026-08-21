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
    payoutMethod = 'crypto',
    network = null,
    walletAddress = null,
    amountUsdt,
    feeUsdt,
    netUsdt,
    feeType = 'fixed',
    exchangeRate = null,
    amountMmk = null,
    bankName = null,
    accountName = null,
    accountNumber = null,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, ref_code, payout_method, network, wallet_address,
        amount_usdt, fee_usdt, net_usdt, fee_type,
        exchange_rate, amount_mmk, bank_name, account_name, account_number,
        status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `,
    userId, refCode, payoutMethod, network, walletAddress,
    amountUsdt, feeUsdt, netUsdt, feeType,
    exchangeRate, amountMmk, bankName, accountName, accountNumber);
    return this.findById(result.lastID);
  },

  async updateStatus(id, { status, adminNote, txHash, processedBy } = {}) {
    const db = getDb();
    const processedAt = ['completed', 'rejected', 'cancelled'].includes(status)
      ? ", processed_at = datetime('now')"
      : '';
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_note = COALESCE(?, admin_note),
          tx_hash = COALESCE(?, tx_hash),
          processed_by = COALESCE(?, processed_by),
          updated_at = datetime('now')
          ${processedAt}
      WHERE id = ?
    `, status, adminNote || null, txHash || null, processedBy ?? null, id);
    return this.findById(id);
  },

  async updatePayoutFields(id, {
    status,
    adminNote,
    txHash,
    processedBy,
    payoutProvider,
    payoutCurrency,
    nowpaymentsPayoutId,
    nowpaymentsWithdrawalId,
  } = {}) {
    const db = getDb();
    const nextStatus = status || null;
    const processedAt = nextStatus && ['completed', 'rejected', 'cancelled'].includes(nextStatus)
      ? ", processed_at = datetime('now')"
      : '';
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = COALESCE(?, status),
          admin_note = COALESCE(?, admin_note),
          tx_hash = COALESCE(?, tx_hash),
          processed_by = COALESCE(?, processed_by),
          payout_provider = COALESCE(?, payout_provider),
          payout_currency = COALESCE(?, payout_currency),
          nowpayments_payout_id = COALESCE(?, nowpayments_payout_id),
          nowpayments_withdrawal_id = COALESCE(?, nowpayments_withdrawal_id),
          updated_at = datetime('now')
          ${processedAt}
      WHERE id = ?
    `,
    nextStatus,
    adminNote || null,
    txHash || null,
    processedBy ?? null,
    payoutProvider || null,
    payoutCurrency || null,
    nowpaymentsPayoutId != null ? String(nowpaymentsPayoutId) : null,
    nowpaymentsWithdrawalId != null ? String(nowpaymentsWithdrawalId) : null,
    id);
    return this.findById(id);
  },

  async findByNowPaymentsPayoutId(payoutId) {
    if (payoutId == null || String(payoutId).trim() === '') return null;
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE}
       WHERE nowpayments_payout_id = ? OR nowpayments_withdrawal_id = ?
       LIMIT 1`,
      String(payoutId),
      String(payoutId)
    );
  },

  async listAll({ status, limit = 200 } = {}) {
    const db = getDb();
    const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const normalized = status == null || status === '' || status === 'all'
      ? null
      : String(status).trim().toLowerCase();

    // open = actionable queue (manual pending + in-flight NOWPayments processing)
    if (normalized === 'open') {
      return db.all(`
        SELECT w.*, u.name AS user_name, u.email AS user_email
        FROM ${this.TABLE} w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE LOWER(w.status) IN ('pending', 'processing')
        ORDER BY w.created_at DESC
        LIMIT ?
      `, lim);
    }

    if (normalized) {
      return db.all(`
        SELECT w.*, u.name AS user_name, u.email AS user_email
        FROM ${this.TABLE} w
        LEFT JOIN users u ON u.id = w.user_id
        WHERE LOWER(w.status) = ?
        ORDER BY w.created_at DESC
        LIMIT ?
      `, normalized, lim);
    }

    return db.all(`
      SELECT w.*, u.name AS user_name, u.email AS user_email
      FROM ${this.TABLE} w
      LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
      LIMIT ?
    `, lim);
  },
};

module.exports = UsdtWithdrawal;
