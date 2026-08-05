-- 002_user_authentication.sql
-- Email OTP, PIN hash, biometrics token, auth profile fields

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

-- Auth columns on users (added via runner-safe pattern in companion JS if columns missing)
-- See migrate.js helper for idempotent ALTERs on existing DBs
