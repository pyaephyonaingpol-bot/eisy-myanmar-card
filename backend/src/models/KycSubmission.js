const { getDb } = require('../db');
const {
  encryptField,
  decryptFieldSafe,
} = require('../services/sensitiveDataCrypto');

const KycSubmission = {
  TABLE: 'kyc_submissions',

  async findById(id) {
    const db = getDb();
    return db.get(`SELECT * FROM ${this.TABLE} WHERE id = ?`, id);
  },

  async findLatestByUserId(userId) {
    const db = getDb();
    return db.get(
      `SELECT * FROM ${this.TABLE} WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      userId
    );
  },

  async listByStatus(status, { limit = 100 } = {}) {
    const db = getDb();
    if (status) {
      return db.all(
        `SELECT * FROM ${this.TABLE} WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        status, limit
      );
    }
    return db.all(
      `SELECT * FROM ${this.TABLE} ORDER BY created_at DESC LIMIT ?`,
      limit
    );
  },

  async create({
    userId,
    fullName,
    idType,
    idNumber,
    frontPhotoPath,
    backPhotoPath,
    selfiePhotoPath,
  }) {
    const db = getDb();
    // Encrypt PII at rest (passport / NRC number + legal name)
    const encryptedFullName = encryptField(fullName);
    const encryptedIdNumber = encryptField(idNumber);

    const result = await db.run(`
      INSERT INTO ${this.TABLE} (
        user_id, full_name, id_type, id_number,
        front_photo_path, back_photo_path, selfie_photo_path,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')
    `,
      userId,
      encryptedFullName,
      idType,
      encryptedIdNumber,
      frontPhotoPath,
      backPhotoPath,
      selfiePhotoPath
    );
    return this.findById(result.lastID);
  },

  async updateReview(id, { status, rejectionReason, reviewedBy }) {
    const db = getDb();
    await db.run(`
      UPDATE ${this.TABLE}
      SET status = ?,
          rejection_reason = ?,
          reviewed_by = ?,
          reviewed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, status, rejectionReason || null, reviewedBy || 'admin', id);
    return this.findById(id);
  },

  /**
   * Map DB row → API payload with decrypted PII for authorized consumers.
   */
  mapForClient(row, { user } = {}) {
    if (!row) return null;
    const fullName = decryptFieldSafe(row.full_name, { fallback: '[unavailable]' });
    const idNumber = decryptFieldSafe(row.id_number, { fallback: '[unavailable]' });
    return {
      id: row.id,
      user_id: row.user_id,
      user_name: user?.name || null,
      user_email: user?.email || null,
      full_name: fullName,
      id_type: row.id_type,
      id_number: idNumber,
      front_photo_path: row.front_photo_path,
      back_photo_path: row.back_photo_path,
      selfie_photo_path: row.selfie_photo_path,
      frontPhotoUrl: row.front_photo_path,
      backPhotoUrl: row.back_photo_path,
      selfieUrl: row.selfie_photo_path,
      status: row.status,
      rejection_reason: row.rejection_reason || null,
      reviewed_by: row.reviewed_by || null,
      reviewed_at: row.reviewed_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  },
};

module.exports = KycSubmission;
