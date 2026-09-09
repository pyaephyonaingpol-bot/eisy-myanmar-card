-- Speed up auth lookups on the login / session critical path.
-- Note: users.email expression index lives in applyUserAuthColumns
-- (email column is added by that patch after SQL migrations).

-- Active session token lookups (unique hash exists; partial index helps revoke filters).
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_active
  ON user_sessions (session_token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

-- OTP verify during email login (latest valid by email+purpose).
CREATE INDEX IF NOT EXISTS idx_otp_email_purpose_created
  ON otp_codes (email, purpose, created_at DESC);
