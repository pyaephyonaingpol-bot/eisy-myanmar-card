-- Multi-admin RBAC: role on users (NULL = regular end-user).
-- Values: super_admin | finance_admin | support_admin

ALTER TABLE users ADD COLUMN admin_role TEXT;

CREATE INDEX IF NOT EXISTS idx_users_admin_role
  ON users (admin_role)
  WHERE admin_role IS NOT NULL;
