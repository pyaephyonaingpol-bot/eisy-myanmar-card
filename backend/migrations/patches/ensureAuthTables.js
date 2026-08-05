/**
 * Idempotent schema repair — creates auth/OTP tables if migrations were skipped or incomplete.
 */
async function tableExists(db, table) {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return Boolean(row);
}

async function ensureAuthTables(db) {
  const repairs = [];

  if (!(await tableExists(db, 'otp_codes'))) {
    repairs.push('otp_codes');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('register', 'login', 'reset_pin', 'verify_email')),
        expires_at TEXT NOT NULL,
        verified_at TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 5,
        ip_address TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes(email, purpose);
      CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
    `);
  }

  if (!(await tableExists(db, 'user_sessions'))) {
    repairs.push('user_sessions');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_token_hash TEXT NOT NULL UNIQUE,
        device_name TEXT,
        device_platform TEXT,
        ip_address TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_seen_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
    `);
  }

  if (!(await tableExists(db, 'transaction_logs'))) {
    repairs.push('transaction_logs');
    await db.exec(`
      CREATE TABLE IF NOT EXISTS transaction_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        direction TEXT DEFAULT 'neutral' CHECK(direction IN ('credit', 'debit', 'neutral')),
        amount_usd REAL,
        amount_mmk REAL,
        balance_before REAL,
        balance_after REAL,
        reference_type TEXT,
        reference_id INTEGER,
        description TEXT NOT NULL,
        metadata TEXT,
        ip_address TEXT,
        created_by TEXT DEFAULT 'system',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_transaction_logs_user ON transaction_logs(user_id, created_at DESC);
    `);
  }

  if (repairs.length > 0) {
    console.log(`[db] Repaired missing tables: ${repairs.join(', ')}`);
  }

  return repairs;
}

module.exports = { ensureAuthTables, tableExists };
