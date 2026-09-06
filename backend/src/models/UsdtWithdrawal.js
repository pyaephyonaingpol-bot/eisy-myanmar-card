const { getDb } = require('../db');

function syncWithdrawalRow(row) {
  if (!row) return;
  try {
    const { syncUsdtWithdrawalRequest, syncUsdtBankWithdrawal } = require('../services/supabaseSyncService');
    syncUsdtWithdrawalRequest(row).catch((err) => {
      console.warn('[supabase] usdt_withdrawal_requests sync:', err.message);
    });
    if (row.payout_method === 'bank') {
      syncUsdtBankWithdrawal(row).catch((err) => {
        console.warn('[supabase] usdt_bank_withdrawals sync:', err.message);
      });
    }
  } catch (_) { /* ignore */ }
}

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
    const row = await this.findById(result.lastID);
    syncWithdrawalRow(row);
    return row;
  },

  async updateStatus(id, {
    status,
    adminNote,
    txHash,
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
          tx_hash = COALESCE(?, tx_hash),
          processed_by = COALESCE(?, processed_by),
          updated_at = datetime('now')
          ${processedAt}
          ${proofSql}
      WHERE id = ?
    `, status, adminNote || null, txHash || null, processedBy ?? null, ...proofParams, id);
    const row = await this.findById(id);
    syncWithdrawalRow(row);
    return row;
  },

  async updatePayoutFields(id, {
    status,
    adminNote,
    txHash,
    processedBy,
    payoutProvider,
    payoutCurrency,
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
    id);
    return this.findById(id);
  },


  async listAll({ status, limit = 200, payoutMethod = null } = {}) {
    const db = getDb();
    const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const normalized = status == null || status === '' || status === 'all'
      ? null
      : String(status).trim().toLowerCase();
    const method = payoutMethod == null || payoutMethod === '' || payoutMethod === 'all'
      ? null
      : String(payoutMethod).trim().toLowerCase();

    const methodClause = method ? ' AND LOWER(w.payout_method) = ?' : '';
    const methodParams = method ? [method] : [];

    // open = actionable queue (pending + processing)
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
        ${methodClause}
        ORDER BY w.created_at DESC
        LIMIT ?
      `, ...methodParams, lim);
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
        ${methodClause}
        ORDER BY w.created_at DESC
        LIMIT ?
      `, normalized, ...methodParams, lim);
    }

    return db.all(`
      SELECT w.*,
             u.name AS user_name,
             u.email AS user_email,
             u.phone AS user_phone,
             u.balance_mmk AS user_balance_mmk
      FROM ${this.TABLE} w
      LEFT JOIN users u ON u.id = w.user_id
      WHERE 1=1
      ${methodClause}
      ORDER BY w.created_at DESC
      LIMIT ?
    `, ...methodParams, lim);
  },
};

module.exports = UsdtWithdrawal;
