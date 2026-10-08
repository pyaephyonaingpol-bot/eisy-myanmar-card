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
  }) {
    const db = getDb();
    const existing = await this.findByEventId(eventId);
    if (existing) {
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

  async listForUser(userId, { localCardId = null, limit = 20, includeExpired = false } = {}) {
    const db = getDb();
    const clauses = ['user_id = ?'];
    const params = [userId];

    if (localCardId != null) {
      clauses.push('local_card_id = ?');
      params.push(localCardId);
    }
    if (!includeExpired) {
      clauses.push("(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");
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

  async listRecentForCard(localCardId, { limit = 10, includeExpired = false } = {}) {
    const db = getDb();
    const clauses = ['local_card_id = ?'];
    const params = [localCardId];
    if (!includeExpired) {
      clauses.push("(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");
    }
    params.push(Math.min(Math.max(Number(limit) || 10, 1), 50));
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
      WHERE id = ? AND user_id = ? AND seen_at IS NULL
    `,
      id,
      userId
    );
    return this.findById(id);
  },
};

module.exports = Pago3dsEvent;
