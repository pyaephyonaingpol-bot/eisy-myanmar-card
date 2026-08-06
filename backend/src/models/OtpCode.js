const { getDb } = require('../db');

const OtpCode = {
  async create({ userId, email, otpCode, purpose, expiresAt, ipAddress }) {
    const db = getDb();
    await db.run(`
      UPDATE otp_codes SET verified_at = datetime('now')
      WHERE email = ? AND purpose = ? AND verified_at IS NULL
    `, email, purpose);

    const result = await db.run(`
      INSERT INTO otp_codes (user_id, email, otp_code, purpose, expires_at, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `, userId || null, email, otpCode, purpose, expiresAt, ipAddress || null);

    return this.findById(result.lastID);
  },

  async findById(id) {
    const db = getDb();
    return db.get('SELECT * FROM otp_codes WHERE id = ?', id);
  },

  async findLatestValid(email, purpose) {
    const db = getDb();
    return db.get(`
      SELECT * FROM otp_codes
      WHERE email = ? AND purpose = ? AND verified_at IS NULL
        AND datetime(expires_at) > datetime('now') AND attempts < max_attempts
      ORDER BY created_at DESC LIMIT 1
    `, email, purpose);
  },

  async incrementAttempts(id) {
    const db = getDb();
    await db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', id);
    return this.findById(id);
  },

  async markVerified(id) {
    const db = getDb();
    await db.run(`
      UPDATE otp_codes SET verified_at = datetime('now') WHERE id = ?
    `, id);
    return this.findById(id);
  },
};

module.exports = OtpCode;
