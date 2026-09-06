-- Speed up admin users list ordering.
-- List queries use ORDER BY created_at DESC, id DESC.
-- auth_status index is created in patches/applyUserAuthColumns.js after that
-- column is ensured (it is not part of 001_initial.sql).

CREATE INDEX IF NOT EXISTS idx_users_created_at_id
  ON users (created_at DESC, id DESC);
