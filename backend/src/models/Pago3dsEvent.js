'use strict';

const { getDb } = require('../db');

const TABLE = 'pago_3ds_events';

function serializePayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function notExpiredClause() {
  // Compare as unix times so ISO-Z and SQLite datetime strings both work.
  return `(expires_at IS NULL OR strftime('%s', expires_at) > strftime('%s', 'now'))`;
}

const Pago3dsEvent = {
  TABLE,

  async findByEventId(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return null;
    const db = getDb();
    return db.get(`SELECT * FROM ${TABLE} WHERE event_id = ? LIMIT 1`, id);
  },

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${TABLE} WHERE id = ?`, id);
  },

  /**
   * Insert a webhook event. Returns { row, duplicate }.
   * Unique on event_id — concurrent retries become duplicates.
   */
  async create({
    eventId,
    eventType = '3ds',
    authId = null,
    otp = null,
    pagoCardId = null,
    localCardId = null,
    userId = null,
    merchantName = null,
    transactionAmount = null,
    transactionCurrency = null,
    verificationType = null,
    userBankcardId = null,
    rawPayload = null,
    expiresAt = null,
    renewExpiry = false,
  }) {
    const db = getDb();
    const existing = await this.findByEventId(eventId);
    if (existing) {
      // Backfill linkage if a later request knows the local card/user.
      // Refresh renews the TTL when the provider still returns the same OTP.
      if (
        (localCardId && !existing.local_card_id)
        || (userId && !existing.user_id)
        || (otp && !existing.otp)
        || (renewExpiry && expiresAt)
      ) {
        await db.run(
          `
          UPDATE ${TABLE}
          SET local_card_id = COALESCE(local_card_id, ?),
              user_id = COALESCE(user_id, ?),
              otp = COALESCE(otp, ?),
              pago_card_id = COALESCE(pago_card_id, ?),
              expires_at = CASE WHEN ? = 1 AND ? IS NOT NULL THEN ? ELSE expires_at END
          WHERE id = ?
        `,
          localCardId ?? null,
          userId ?? null,
          otp || null,
          pagoCardId || null,
          renewExpiry ? 1 : 0,
          expiresAt || null,
          expiresAt || null,
          existing.id
        );
        return { row: await this.findById(existing.id), duplicate: true };
      }
      return { row: existing, duplicate: true };
    }

    try {
      const result = await db.run(
        `
        INSERT INTO ${TABLE} (
          event_id, event_type, auth_id, otp, pago_card_id, local_card_id, user_id,
          merchant_name, transaction_amount, transaction_currency, verification_type,
          user_bankcard_id, raw_payload, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        String(eventId).trim(),
        String(eventType || '3ds').trim() || '3ds',
        authId || null,
        otp || null,
        pagoCardId || null,
        localCardId ?? null,
        userId ?? null,
        merchantName || null,
        transactionAmount || null,
        transactionCurrency || null,
        verificationType || null,
        userBankcardId || null,
        serializePayload(rawPayload),
        expiresAt || null
      );
      const row = await this.findById(result.lastID);
      return { row, duplicate: false };
    } catch (err) {
      if (/unique/i.test(String(err.message || ''))) {
        const raced = await this.findByEventId(eventId);
        if (raced) return { row: raced, duplicate: true };
      }
      throw err;
    }
  },

  /**
   * Attach orphan webhook rows (null user/local ids) to a known local card.
   */
  async linkOrphansByPagoCardId(pagoCardId, { localCardId, userId } = {}) {
    const id = String(pagoCardId || '').trim();
    if (!id || localCardId == null || userId == null) return 0;
    const db = getDb();
    const result = await db.run(
      `
      UPDATE ${TABLE}
      SET local_card_id = COALESCE(local_card_id, ?),
          user_id = COALESCE(user_id, ?)
      WHERE pago_card_id = ?
        AND (local_card_id IS NULL OR user_id IS NULL)
    `,
      localCardId,
      userId,
      id
    );
    return Number(result?.changes || 0);
  },

  /**
   * List events visible to a user.
   * Matches owned rows and orphans whose pago_card_id belongs to the user's card.
   * Caller must only pass pagoCardId/localCardId for cards they already authorized.
   */
  async listForUser(userId, {
    localCardId = null,
    pagoCardId = null,
    limit = 20,
    includeExpired = false,
  } = {}) {
    const db = getDb();
    const clauses = [];
    const params = [];
    const pagoId = pagoCardId ? String(pagoCardId).trim() : '';

    if (localCardId != null && pagoId) {
      // Per-card: own linked rows OR orphans for this provider card id.
      clauses.push(`(
        (user_id = ? AND (local_card_id = ? OR pago_card_id = ?))
        OR (user_id IS NULL AND pago_card_id = ?)
        OR (local_card_id = ? AND user_id IS NULL)
      )`);
      params.push(userId, localCardId, pagoId, pagoId, localCardId);
    } else if (localCardId != null) {
      clauses.push('(user_id = ? AND local_card_id = ?) OR (local_card_id = ? AND user_id IS NULL)');
      params.push(userId, localCardId, localCardId);
    } else if (pagoId) {
      clauses.push('(user_id = ? AND pago_card_id = ?) OR (user_id IS NULL AND pago_card_id = ?)');
      params.push(userId, pagoId, pagoId);
    } else {
      clauses.push(`(
        user_id = ?
        OR (
          user_id IS NULL
          AND pago_card_id IS NOT NULL
          AND pago_card_id IN (
            SELECT pago_card_id FROM cards_v2
            WHERE user_id = ? AND pago_card_id IS NOT NULL AND pago_card_id != ''
          )
        )
      )`);
      params.push(userId, userId);
    }

    if (!includeExpired) {
      clauses.push(notExpiredClause());
    }

    params.push(Math.min(Math.max(Number(limit) || 20, 1), 100));

    return db.all(
      `
      SELECT * FROM ${TABLE}
      WHERE ${clauses.join(' AND ')}
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `,
      ...params
    );
  },

  async markSeen(id, userId) {
    const db = getDb();
    await db.run(
      `
      UPDATE ${TABLE}
      SET seen_at = datetime('now')
      WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND seen_at IS NULL
    `,
      id,
      userId
    );
    const row = await this.findById(id);
    if (row && row.user_id == null && userId) {
      await db.run(`UPDATE ${TABLE} SET user_id = ? WHERE id = ?`, userId, id);
      return this.findById(id);
    }
    return row && (row.user_id == null || Number(row.user_id) === Number(userId)) ? row : null;
  },
};

module.exports = Pago3dsEvent;
