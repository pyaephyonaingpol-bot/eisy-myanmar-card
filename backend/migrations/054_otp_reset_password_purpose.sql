-- Allow email OTP purpose for password resets (in addition to reset_pin).
-- SQLite cannot ALTER CHECK constraints in place — rebuild otp_codes.

CREATE TABLE IF NOT EXISTS otp_codes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register', 'login', 'reset_pin', 'verify_email', 'reset_password')),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO otp_codes_new (
  id, user_id, email, otp_code, purpose, expires_at, verified_at,
  attempts, max_attempts, ip_address, created_at
)
SELECT
  id, user_id, email, otp_code, purpose, expires_at, verified_at,
  attempts, max_attempts, ip_address, created_at
FROM otp_codes;

DROP TABLE otp_codes;
ALTER TABLE otp_codes_new RENAME TO otp_codes;

CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes(email, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
