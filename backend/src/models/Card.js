const { getDb } = require('../db');
const { syncCardApplication } = require('../services/supabaseSyncService');

const Card = {
  TABLE: 'cards_v2',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findByUserId(userId, { status } = {}) {
    const db = getDb();
    if (status) {
      return db.all(
        `SELECT * FROM ${this.TABLE} WHERE user_id = ? AND status = ? ORDER BY is_primary DESC, created_at DESC`,
        userId, status
      );
    }
    return db.all(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC`,
      userId
    );
  },

  async findPrimaryByUserId(userId) {
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? AND is_primary = 1 LIMIT 1`,
      userId
    );
  },

  async issue({
    userId, cardNumber, expDate, cvv, cardHolderName,
    cardType = 'virtual', currency = 'USD', status = 'active',
    issuedByAdminId, adminNotes, isPrimary = false, dailyLimitUsd, metadata,
  }) {
    const db = getDb();
    await db.run('BEGIN');
    try {
      if (isPrimary) {
        await db.run(
          `UPDATE ${this.TABLE} SET is_primary = 0, updated_at = datetime('now') WHERE user_id = ?`,
          userId
        );
      }

      const result = await db.run(`
        INSERT INTO ${this.TABLE} (
          user_id, card_number, exp_date, cvv, card_holder_name,
          card_type, currency, status, is_primary, issued_by_admin_id,
          admin_notes, daily_limit_usd, metadata, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
        userId, cardNumber, expDate, cvv, cardHolderName,
        cardType, currency, status, isPrimary ? 1 : 0, issuedByAdminId || null,
        adminNotes || null, dailyLimitUsd || null,
        metadata ? JSON.stringify(metadata) : null
      );

      await db.run('COMMIT');
      const row = await this.findById(result.lastID);
      syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
      return row;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  },

  async updateStatus(id, status, { adminNotes, adminId, statusReason } = {}) {
    const db = getDb();
    const normalized = String(status || '').toLowerCase();
    let extra = '';
    if (normalized === 'cancelled' || normalized === 'terminated') {
      extra = ", cancelled_at = datetime('now')";
    } else if (normalized === 'active') {
      extra = ", activated_at = datetime('now'), suspended_at = NULL";
    } else if (normalized === 'suspended' || normalized === 'frozen') {
      extra = ", suspended_at = datetime('now')";
    }

    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          admin_notes = COALESCE(?, admin_notes),
          status_reason = COALESCE(?, status_reason),
          issued_by_admin_id = COALESCE(?, issued_by_admin_id),
          updated_at = datetime('now')${extra}
      WHERE id = ?
    `, normalized, adminNotes || null, statusReason || null, adminId || null, id);

    const row = await this.findById(id);
    syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
    return row;
  },

  async setPrimary(id, userId) {
    const db = getDb();
    await db.run('BEGIN');
    try {
      await db.run(
        `UPDATE ${this.TABLE} SET is_primary = 0, updated_at = datetime('now') WHERE user_id = ?`,
        userId
      );
      await db.run(
        `UPDATE ${this.TABLE} SET is_primary = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        id, userId
      );
      await db.run('COMMIT');
      return this.findById(id);
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  },

  async requestPending({ userId, cardHolderName, userNote, metadata }) {
    const db = getDb();
    const placeholder = `PENDING-${userId}-${Date.now()}`;
    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, card_number, exp_date, cvv, card_holder_name,
        card_type, status, is_primary, admin_notes, metadata, updated_at
      ) VALUES (?, ?, '—', '—', ?, 'virtual', 'pending', 0, ?, ?, datetime('now'))
    `, userId, placeholder, cardHolderName, userNote || 'User requested new virtual card',
      metadata ? JSON.stringify(metadata) : null);

    const row = await this.findById(result.lastID);
    syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
    return row;
  },

  /** Force-assign full card credentials when activating a pending request. */
  async activatePendingCard(id, {
    cardNumber, expDate, cvv, cardHolderName,
    adminNotes, adminId, balanceUsd,
  }) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;

    let metadata = {};
    try {
      metadata = existing.metadata ? JSON.parse(existing.metadata) : {};
    } catch (_) {}

    if (balanceUsd !== undefined && balanceUsd !== null) {
      metadata.balance_usd = parseFloat(balanceUsd);
    }
    metadata.request_status = 'approved';
    metadata.activated_at = new Date().toISOString();

    await db.run(`
      UPDATE ${this.TABLE}
      SET card_number = ?,
          exp_date = ?,
          cvv = ?,
          card_holder_name = COALESCE(?, card_holder_name),
          status = 'active',
          admin_notes = COALESCE(?, admin_notes),
          issued_by_admin_id = COALESCE(?, issued_by_admin_id),
          metadata = ?,
          updated_at = datetime('now'),
          activated_at = datetime('now')
      WHERE id = ?
    `,
      cardNumber, expDate, cvv, cardHolderName || null,
      adminNotes || null, adminId || null,
      JSON.stringify(metadata), id);

    const row = await this.findById(id);
    syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
    return row;
  },

  async updateCardDetails(id, {
    cardNumber, expDate, cvv, cardHolderName, status,
    adminNotes, adminId, dailyLimitUsd, balanceUsd,
  }) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;

    let metadata = {};
    try {
      metadata = existing.metadata ? JSON.parse(existing.metadata) : {};
    } catch (_) {}

    if (balanceUsd !== undefined && balanceUsd !== null) {
      metadata.balance_usd = parseFloat(balanceUsd);
    }

    await db.run(`
      UPDATE ${this.TABLE}
      SET card_number = COALESCE(?, card_number),
          exp_date = COALESCE(?, exp_date),
          cvv = COALESCE(?, cvv),
          card_holder_name = COALESCE(?, card_holder_name),
          status = COALESCE(?, status),
          admin_notes = COALESCE(?, admin_notes),
          issued_by_admin_id = COALESCE(?, issued_by_admin_id),
          daily_limit_usd = COALESCE(?, daily_limit_usd),
          metadata = ?,
          updated_at = datetime('now'),
          activated_at = CASE WHEN ? = 'active' THEN datetime('now') ELSE activated_at END
      WHERE id = ?
    `,
      cardNumber || null, expDate || null, cvv || null, cardHolderName || null,
      status || null, adminNotes || null, adminId || null, dailyLimitUsd ?? null,
      JSON.stringify(metadata), status || existing.status, id
    );

    const row = await this.findById(id);
    syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
    return row;
  },

  async listPendingRequests() {
    const db = getDb();
    return db.all(`
      SELECT c.*, u.email, u.name, u.phone
      FROM ${this.TABLE} c
      JOIN users u ON u.id = c.user_id
      WHERE c.status = 'pending'
      ORDER BY c.created_at ASC
    `);
  },

  async listIssuedCards() {
    const db = getDb();
    return db.all(`
      SELECT c.*, u.email, u.name, u.phone
      FROM ${this.TABLE} c
      JOIN users u ON u.id = c.user_id
      WHERE c.status != 'pending'
        AND c.card_number NOT LIKE 'PENDING-%'
      ORDER BY c.updated_at DESC, c.created_at DESC
    `);
  },

  async listAll({ limit = 100 } = {}) {
    const db = getDb();
    return db.all(`
      SELECT c.*, u.email, u.name
      FROM ${this.TABLE} c
      JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC LIMIT ?
    `, limit);
  },

  /**
   * Soft-remove a card from the user's My Cards list.
   * Pending requests are cancelled; issued cards are hidden via metadata
   * (ledger / reload history stays intact — no hard DELETE).
   */
  async removeFromUserList(id, userId, { reason } = {}) {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing || Number(existing.user_id) !== Number(userId)) return null;

    let metadata = {};
    try {
      metadata = existing.metadata ? JSON.parse(existing.metadata) : {};
    } catch (_) {
      metadata = {};
    }

    const status = String(existing.status || '').toLowerCase();
    const isPending =
      status === 'pending' || String(existing.card_number || '').startsWith('PENDING-');

    metadata.removed_by_user = true;
    metadata.removed_at = new Date().toISOString();
    if (reason) metadata.removed_reason = String(reason).slice(0, 200);

    if (isPending) {
      await db.run(`
        UPDATE ${this.TABLE}
        SET status = 'cancelled',
            cancelled_at = datetime('now'),
            status_reason = COALESCE(?, status_reason),
            metadata = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `, reason || 'Removed by user', JSON.stringify(metadata), id, userId);
    } else {
      await db.run(`
        UPDATE ${this.TABLE}
        SET metadata = ?,
            updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `, JSON.stringify(metadata), id, userId);
    }

    const row = await this.findById(id);
    syncCardApplication(row).catch((err) => console.warn('[supabase] card sync:', err.message));
    return row;
  },
};

module.exports = Card;
