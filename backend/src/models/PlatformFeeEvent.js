const { getDb } = require('../db');
const { parseRecordMetadata } = require('../services/settingsService');

const PlatformFeeEvent = {
  TABLE: 'platform_fee_events',

  async create({
    feeType,
    amount,
    currency,
    referenceType,
    referenceId,
    relatedUserId,
    description,
    metadata,
    collectedAt,
    createdBy = 'system',
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        fee_type, amount, currency, reference_type, reference_id,
        related_user_id, description, metadata, collected_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
    `,
      feeType,
      amount,
      currency,
      referenceType ?? null,
      referenceId ?? null,
      relatedUserId ?? null,
      description ?? null,
      metadata ? JSON.stringify(metadata) : null,
      collectedAt ?? null,
      createdBy
    );
    return this.findById(result.lastID);
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByReference(referenceType, referenceId) {
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE} WHERE reference_type = ? AND reference_id = ?`,
      referenceType,
      referenceId
    );
  },

  async listByFeeType(feeType, { limit = 200 } = {}) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE fee_type = ? ORDER BY collected_at DESC LIMIT ?`,
      feeType,
      limit
    );
  },

  async listAll({ feeType, limit = 500 } = {}) {
    const db = getDb();
    if (feeType) {
      return this.listByFeeType(feeType, { limit });
    }
    return db.all(
      `SELECT * FROM ${this.TABLE} ORDER BY collected_at DESC LIMIT ?`,
      limit
    );
  },

  mapForClient(row) {
    if (!row) return null;
    return {
      id: row.id,
      fee_type: row.fee_type,
      amount: row.amount,
      currency: row.currency,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      related_user_id: row.related_user_id,
      description: row.description,
      metadata: parseRecordMetadata(row.metadata),
      collected_at: row.collected_at,
      created_by: row.created_by,
    };
  },
};

module.exports = PlatformFeeEvent;
