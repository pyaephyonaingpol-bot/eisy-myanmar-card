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

    return db.get('SELECT * FROM user_sessions WHERE id = ?', result.lastID);
  },

  async findByToken(sessionToken) {
    const db = getDb();
    const hash = this.hashToken(sessionToken);
    return db.get(`
      SELECT s.*, s.user_id, u.id as uid, u.email, u.name, u.phone,
             u.email_verified, u.pin_hash, u.biometrics_enabled, u.auth_status,
             u.admin_role
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
