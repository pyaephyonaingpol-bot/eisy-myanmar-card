const { getDb } = require('../db');

const PUBLIC_FIELDS = [
  'id', 'name', 'phone', 'email', 'username', 'email_verified', 'kyc_status', 'balance', 'balance_mmk', 'balance_usdt',
  'balance_usdt_locked',
  'auth_status', 'biometrics_enabled', 'last_login_at', 'created_at', 'updated_at',
  'terms_accepted', 'terms_accepted_at', 'terms_version',
];

function stripPrivate(user) {
  if (!user) return null;
  const out = {};
  for (const key of PUBLIC_FIELDS) {
    if (user[key] !== undefined) out[key] = user[key];
  }
  return out;
}

/** Core wallet User shape: id, email/username, balance, createdAt, updatedAt */
function toWalletPublic(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    username: user.username ?? null,
    balance: Number(user.balance_usdt ?? user.balance ?? 0),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

const User = {
  async findById(id) {
    const db = getDb();
    return db.get('SELECT * FROM users WHERE id = ?', id);
  },

  async findByEmail(email) {
    const db = getDb();
    const normalized = String(email || '').trim().toLowerCase();
    return db.get(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = ?',
      normalized
    );
  },

  async findByUsername(username) {
    const db = getDb();
    const normalized = String(username || '').trim().toLowerCase();
    if (!normalized) return null;
    return db.get(
      'SELECT * FROM users WHERE LOWER(TRIM(username)) = ?',
      normalized
    );
  },

  async findByPhone(phone) {
    const db = getDb();
    return db.get('SELECT * FROM users WHERE phone = ?', phone);
  },

  async create({
    name,
    phone,
    email,
    pinHash,
    termsAccepted = false,
    termsVersion = null,
  }) {
    const db = getDb();
    const accepted = termsAccepted ? 1 : 0;
    const version = accepted && termsVersion ? String(termsVersion) : null;
    const result = await db.run(`
      INSERT INTO users (
        name, phone, email, pin_hash, pin_set_at, email_verified,
        terms_accepted, terms_accepted_at, terms_version, updated_at
      )
      VALUES (
        ?, ?, ?, ?,
        CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END,
        0,
        ?,
        CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
        ?,
        datetime('now')
      )
    `, name, phone, email || null, pinHash || null, pinHash || null, accepted, accepted, version);
    return this.findById(result.lastID);
  },

  async updatePin(userId, pinHash) {
    const db = getDb();
    await db.run(`
      UPDATE users SET pin_hash = ?, pin_set_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, pinHash, userId);
    return this.findById(userId);
  },

  async updatePassword(userId, passwordHash) {
    const db = getDb();
    await db.run(`
      UPDATE users SET password_hash = ?, password_set_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, passwordHash, userId);
    return this.findById(userId);
  },

  async setBiometricsToken(userId, tokenHash, enabled = true) {
    const db = getDb();
    await db.run(`
      UPDATE users
      SET biometrics_token_hash = ?,
          biometrics_enabled = ?,
          biometrics_registered_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, tokenHash, enabled ? 1 : 0, userId);
    return this.findById(userId);
  },

  async verifyEmail(userId) {
    const db = getDb();
    await db.run(`
      UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?
    `, userId);
    return this.findById(userId);
  },

  async updateBalanceMmk(userId, newBalanceMmk) {
    const db = getDb();
    await db.run(`
      UPDATE users SET balance_mmk = ?, updated_at = datetime('now') WHERE id = ?
    `, newBalanceMmk, userId);
    return this.findById(userId);
  },

  async updateBalance(userId, newBalance) {
    const db = getDb();
    await db.run(`
      UPDATE users SET balance = ?, updated_at = datetime('now') WHERE id = ?
    `, newBalance, userId);
    return this.findById(userId);
  },

  async updateUsername(userId, username) {
    const db = getDb();
    const value = username != null ? String(username).trim() : null;
    await db.run(`
      UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?
    `, value || null, userId);
    return this.findById(userId);
  },

  async recordLogin(userId) {
    const db = getDb();
    await db.run(`
      UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `, userId);
  },

  async updateProfile(userId, { name, phone } = {}) {
    const db = getDb();
    const current = await this.findById(userId);
    if (!current) return null;
    const nextName = name != null ? String(name).trim() : current.name;
    const nextPhone = phone != null ? String(phone).trim() : current.phone;
    await db.run(`
      UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?
    `, nextName, nextPhone, userId);
    return this.findById(userId);
  },

  async setAuthStatus(userId, status) {
    const db = getDb();
    const value = String(status || 'active').trim().toLowerCase() || 'active';
    await db.run(`
      UPDATE users SET auth_status = ?, updated_at = datetime('now') WHERE id = ?
    `, value, userId);
    return this.findById(userId);
  },

  async setAdminRole(userId, role) {
    const db = getDb();
    const value = role ? String(role).trim() : null;
    await db.run(`
      UPDATE users SET admin_role = ?, updated_at = datetime('now') WHERE id = ?
    `, value, userId);
    return this.findById(userId);
  },

  async listAdmins() {
    const db = getDb();
    return db.all(`
      SELECT * FROM users
      WHERE admin_role IS NOT NULL AND TRIM(admin_role) != ''
      ORDER BY
        CASE admin_role
          WHEN 'super_admin' THEN 1
          WHEN 'finance_admin' THEN 2
          WHEN 'support_admin' THEN 3
          ELSE 4
        END,
        id ASC
    `);
  },

  async countAdmins() {
    const db = getDb();
    const row = await db.get(`
      SELECT COUNT(*) AS c FROM users
      WHERE admin_role IS NOT NULL AND TRIM(admin_role) != ''
    `);
    return Number(row?.c || 0);
  },

  async countAdminsByRole(role) {
    const db = getDb();
    const row = await db.get(`
      SELECT COUNT(*) AS c FROM users WHERE admin_role = ?
    `, role);
    return Number(row?.c || 0);
  },

  /**
   * Lean admin users list — single-table, no joins.
   * Supports limit/offset pagination plus optional q / auth_status filters.
   */
  async listForAdmin({
    limit = 50,
    offset = 0,
    q = '',
    status = '',
  } = {}) {
    const db = getDb();
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const query = String(q || '').trim();
    const authStatus = String(status || '').trim().toLowerCase();

    const where = [];
    const params = [];

    if (authStatus === 'active' || authStatus === 'blocked') {
      where.push('LOWER(COALESCE(auth_status, \'active\')) = ?');
      params.push(authStatus);
    }

    if (query) {
      const asId = Number(query);
      if (Number.isInteger(asId) && String(asId) === query) {
        where.push('id = ?');
        params.push(asId);
      } else {
        const like = `%${query.toLowerCase()}%`;
        where.push('(LOWER(COALESCE(email, \'\')) LIKE ? OR LOWER(COALESCE(name, \'\')) LIKE ?)');
        params.push(like, like);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM users ${whereSql}`,
      ...params
    );
    const total = Number(totalRow?.c || 0);

    const users = await db.all(
      `SELECT id, email, name, balance_usdt, auth_status, created_at
       FROM users
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      safeLimit,
      safeOffset
    );

    return {
      users,
      total,
      count: users.length,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + users.length < total,
    };
  },

  stripPrivate,
  toWalletPublic,
};

module.exports = User;
