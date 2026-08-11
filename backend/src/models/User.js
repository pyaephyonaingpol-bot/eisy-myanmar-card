const { getDb } = require('../db');

const PUBLIC_FIELDS = [
  'id', 'name', 'phone', 'email', 'username', 'email_verified', 'kyc_status', 'balance', 'balance_mmk', 'balance_usdt',
  'auth_status', 'biometrics_enabled', 'last_login_at', 'created_at', 'updated_at',
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

  async create({ name, phone, email, pinHash }) {
    const db = getDb();
    const result = await db.run(`
      INSERT INTO users (name, phone, email, pin_hash, pin_set_at, email_verified, updated_at)
      VALUES (?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END, 0, datetime('now'))
    `, name, phone, email || null, pinHash || null, pinHash || null);
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

  stripPrivate,
  toWalletPublic,
};

module.exports = User;
