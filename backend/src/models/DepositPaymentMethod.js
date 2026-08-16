const { getDb } = require('../db');

const METHOD_TYPES = ['kbzpay', 'wavepay', 'bank_transfer', 'other'];

const DepositPaymentMethod = {
  TABLE: 'deposit_payment_methods',
  METHOD_TYPES,

  toPublic(row) {
    if (!row) return null;
    return {
      id: row.id,
      bank_name: row.bank_name,
      account_name: row.account_name,
      account_number: row.account_number,
      method_type: row.method_type || 'bank_transfer',
      notes: row.notes || null,
      qr_code_image_url: row.qr_code_image_url || null,
      is_active: Number(row.is_active) === 1,
      sort_order: Number(row.sort_order) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
      label: `${row.bank_name} — ${row.account_name}`,
    };
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async listAll({ activeOnly = false } = {}) {
    const db = getDb();
    if (activeOnly) {
      return db.all(
        `SELECT * FROM ${this.TABLE}
         WHERE is_active = 1
         ORDER BY sort_order ASC, id ASC`
      );
    }
    return db.all(
      `SELECT * FROM ${this.TABLE}
       ORDER BY is_active DESC, sort_order ASC, id ASC`
    );
  },

  async create({
    bankName,
    accountName,
    accountNumber,
    methodType = 'bank_transfer',
    notes = null,
    qrCodeImageUrl = null,
    isActive = true,
    sortOrder = 0,
  }) {
    const db = getDb();
    const result = await db.run(
      `INSERT INTO ${this.TABLE}
        (bank_name, account_name, account_number, method_type, notes, qr_code_image_url, is_active, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      bankName,
      accountName,
      accountNumber,
      methodType || 'bank_transfer',
      notes || null,
      qrCodeImageUrl || null,
      isActive ? 1 : 0,
      Number(sortOrder) || 0
    );
    return this.findById(result.lastID);
  },

  async update(id, fields = {}) {
    const existing = await this.findById(id);
    if (!existing) return null;

    const bankName = fields.bankName ?? fields.bank_name ?? existing.bank_name;
    const accountName = fields.accountName ?? fields.account_name ?? existing.account_name;
    const accountNumber = fields.accountNumber ?? fields.account_number ?? existing.account_number;
    const methodType = fields.methodType ?? fields.method_type ?? existing.method_type ?? 'bank_transfer';
    const notes = fields.notes !== undefined ? fields.notes : existing.notes;
    const qrCodeImageUrl = fields.qrCodeImageUrl !== undefined
      ? fields.qrCodeImageUrl
      : (fields.qr_code_image_url !== undefined ? fields.qr_code_image_url : existing.qr_code_image_url);
    const isActive = fields.isActive !== undefined
      ? fields.isActive
      : (fields.is_active !== undefined ? fields.is_active : existing.is_active);
    const sortOrder = fields.sortOrder ?? fields.sort_order ?? existing.sort_order;

    const db = getDb();
    await db.run(
      `UPDATE ${this.TABLE}
       SET bank_name = ?,
           account_name = ?,
           account_number = ?,
           method_type = ?,
           notes = ?,
           qr_code_image_url = ?,
           is_active = ?,
           sort_order = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      bankName,
      accountName,
      accountNumber,
      methodType || 'bank_transfer',
      notes || null,
      qrCodeImageUrl || null,
      isActive ? 1 : 0,
      Number(sortOrder) || 0,
      id
    );
    return this.findById(id);
  },

  async remove(id) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;
    await db.run(`DELETE FROM ${this.TABLE} WHERE id = ?`, id);
    return existing;
  },
};

module.exports = DepositPaymentMethod;
