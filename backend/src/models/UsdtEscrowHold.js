const { getDb } = require('../db');

function normalizeReferenceId(referenceId) {
  const id = parseInt(referenceId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const UsdtEscrowHold = {
  TABLE: 'usdt_escrow_holds',

  async findByReference(referenceType, referenceId, holdType) {
    const refId = normalizeReferenceId(referenceId);
    if (!refId) return null;
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE}
       WHERE reference_type = ? AND reference_id = ? AND hold_type = ?
       ORDER BY id DESC LIMIT 1`,
      referenceType,
      refId,
      holdType
    );
  },

  async findActiveByReference(referenceType, referenceId, holdType) {
    const refId = normalizeReferenceId(referenceId);
    if (!refId) return null;
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE}
       WHERE reference_type = ? AND reference_id = ? AND hold_type = ? AND status = 'active'
       LIMIT 1`,
      referenceType,
      refId,
      holdType
    );
  },

  async findByUserId(userId, { status = 'active', limit = 50 } = {}) {
    const db = getDb();
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      status,
      limit
    );
  },
};

module.exports = UsdtEscrowHold;
