const { getDb } = require('../db');

const UsdtWalletTransaction = {
  TABLE: 'usdt_wallet_transactions',

  async create({
    userId,
    network = null,
    txType,
    direction = 'neutral',
    amountUsdt = 0,
    balanceAfter = null,
    txHash = null,
    counterpartyAddress = null,
    status = 'completed',
    referenceType = null,
    referenceId = null,
    description = null,
    metadata = null,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, network, tx_type, direction, amount_usdt, balance_after,
        tx_hash, counterparty_address, status, reference_type, reference_id,
        description, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      userId,
      network,
      txType,
      direction,
      amountUsdt,
      balanceAfter,
      txHash,
      counterpartyAddress,
      status,
      referenceType,
      referenceId,
      description,
      metadata ? JSON.stringify(metadata) : null
    );
    return this.findById(result.lastID);
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByUserId(userId, { limit = 100, offset = 0, network = null } = {}) {
    const db = getDb();
    if (network) {
      return db.all(`
        SELECT * FROM ${this.TABLE}
        WHERE user_id = ? AND (network = ? OR network IS NULL)
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `, userId, network, limit, offset);
    }
    return db.all(`
      SELECT * FROM ${this.TABLE}
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, userId, limit, offset);
  },

  async countByUserId(userId) {
    const db = getDb();
    const row = await db.get(
      `SELECT COUNT(*) AS cnt FROM ${this.TABLE} WHERE user_id = ?`,
      userId
    );
    return Number(row?.cnt ?? 0);
  },

  async findDuplicateReference(userId, referenceType, referenceId, txType) {
    const db = getDb();
    return db.get(`
      SELECT id FROM ${this.TABLE}
      WHERE user_id = ? AND reference_type = ? AND reference_id = ? AND tx_type = ?
      LIMIT 1
    `, userId, referenceType, referenceId, txType);
  },
};

module.exports = UsdtWalletTransaction;
