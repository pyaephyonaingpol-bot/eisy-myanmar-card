const { getDb } = require('../db');
const crypto = require('crypto');

const UserSession = {
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  },

  async create({ userId, sessionToken, deviceName, devicePlatform, ipAddress, expiresAt }) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    const result = await db.run(`
      INSERT INTO user_sessions (
        user_id, session_token_hash, device_name, device_platform, ip_address, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, userId, hash, deviceName || null, devicePlatform || null, ipAddress || null, expiresAt);

    // Avoid a round-trip SELECT on the login hot path — callers only need id + expires_at.
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return {
      id: result.lastID,
      user_id: userId,
      session_token_hash: hash,
      device_name: deviceName || null,
      device_platform: devicePlatform || null,
      ip_address: ipAddress || null,
      expires_at: expiresAt,
      revoked_at: null,
      last_seen_at: now,
      created_at: now,
    };
  },

  async findByToken(sessionToken) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    return db.get(`
      SELECT s.*, s.user_id, u.id as uid, u.email, u.name, u.phone, u.username,
             u.email_verified, u.pin_hash, u.password_hash, u.biometrics_enabled,
             u.auth_status, u.admin_role, u.kyc_status,
             u.balance, u.balance_mmk, u.balance_usdt, u.balance_usdt_locked,
             u.last_login_at, u.created_at, u.updated_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
        AND s.revoked_at IS NULL
        AND datetime(s.expires_at) > datetime('now')
    `, hash);
  },

  async revoke(sessionToken) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    await db.run(`
      UPDATE user_sessions SET revoked_at = datetime('now') WHERE session_token_hash = ?
    `, hash);
  },

  async revokeAllForUser(userId) {
    const db = getDb();
    const result = await db.run(`
      UPDATE user_sessions
      SET revoked_at = datetime('now')
      WHERE user_id = ?
        AND revoked_at IS NULL
    `, userId);
    return Number(result?.changes || 0);
  },

  /**
   * Keep only the given token active — used for single-session enforcement
   * after a new login on another device.
   */
  async revokeAllExcept(userId, sessionToken) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    const result = await db.run(`
      UPDATE user_sessions
      SET revoked_at = datetime('now')
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND session_token_hash != ?
    `, userId, hash);
    return Number(result?.changes || 0);
  },

  /**
   * Classify why findByToken returned null — superseded vs missing/expired.
   * @returns {'SESSION_SUPERSEDED'|'SESSION_INVALID'|null}
   */
  async classifyMissingToken(sessionToken) {
    if (!sessionToken) return null;
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    const row = await db.get(
      `SELECT id, user_id, revoked_at, expires_at, created_at
       FROM user_sessions
       WHERE session_token_hash = ?
       LIMIT 1`,
      hash
    );
    if (!row) return 'SESSION_INVALID';

    const revoked = Boolean(row.revoked_at);
    const expired = !(await db.get(
      `SELECT 1 AS ok
       FROM user_sessions
       WHERE id = ?
         AND datetime(expires_at) > datetime('now')`,
      row.id
    ));

    if (!revoked && !expired) return null; // race: became valid again

    if (revoked) {
      // Another (newer) active session → kicked by concurrent login.
      const newer = await db.get(
        `SELECT id FROM user_sessions
         WHERE user_id = ?
           AND revoked_at IS NULL
           AND datetime(expires_at) > datetime('now')
           AND datetime(created_at) >= datetime(?)
         LIMIT 1`,
        row.user_id,
        row.created_at || '1970-01-01'
      );
      if (newer) return 'SESSION_SUPERSEDED';
    }
    return 'SESSION_INVALID';
  },

  async touch(sessionToken, expiresAt) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    if (expiresAt) {
      await db.run(`
        UPDATE user_sessions
        SET last_seen_at = datetime('now'), expires_at = ?
        WHERE session_token_hash = ?
      `, expiresAt, hash);
      return;
    }
    await db.run(`
      UPDATE user_sessions SET last_seen_at = datetime('now') WHERE session_token_hash = ?
    `, hash);
  },
};

module.exports = UserSession;
