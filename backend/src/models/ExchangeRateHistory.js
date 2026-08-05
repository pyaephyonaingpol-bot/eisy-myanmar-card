const { getDb } = require('../db');

const ExchangeRateHistory = {
  TABLE: 'exchange_rate_history',

  async create({
    effectiveAt,
    mmkToUsdRate,
    cardIssuanceFeeUsd,
    minimumInitialDepositUsd,
    updatedBy = 'admin',
    notes,
  }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        effective_at, mmk_to_usd_rate, card_issuance_fee_usd,
        minimum_initial_deposit_usd, updated_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      effectiveAt,
      mmkToUsdRate,
      cardIssuanceFeeUsd,
      minimumInitialDepositUsd ?? null,
      updatedBy,
      notes || null
    );
    return this.findById(result.lastID);
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async listRecent({ limit = 100 } = {}) {
    const db = getDb();
    return db.all(`
      SELECT * FROM ${this.TABLE}
      ORDER BY effective_at DESC, id DESC
      LIMIT ?
    `, limit);
  },

  async getLatest() {
    const db = getDb();
    return db.get(`
      SELECT * FROM ${this.TABLE}
      ORDER BY effective_at DESC, id DESC
      LIMIT 1
    `);
  },
};

module.exports = ExchangeRateHistory;
