-- Canonical app identity is users.id. Child rows already reference that integer.
-- auth_user_id stores a Supabase Auth UUID when a wallet was keyed by that UUID
-- instead of users.id. Existing rows stay in place; this column starts empty.
ALTER TABLE users ADD COLUMN auth_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id
  ON users(auth_user_id)
  WHERE auth_user_id IS NOT NULL AND TRIM(auth_user_id) != '';
