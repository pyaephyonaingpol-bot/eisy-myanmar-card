const USER_AUTH_COLUMNS = [
  ['email', 'TEXT'],
  ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['pin_hash', 'TEXT'],
  ['pin_set_at', 'TEXT'],
  ['biometrics_token_hash', 'TEXT'],
  ['biometrics_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['biometrics_registered_at', 'TEXT'],
  ['auth_status', "TEXT NOT NULL DEFAULT 'active'"],
  ['last_login_at', 'TEXT'],
  ['updated_at', 'TEXT'],
];

async function applyUserAuthColumns(db, columnExists) {
  for (const [name, definition] of USER_AUTH_COLUMNS) {
    if (!(await columnExists(db, 'users', name))) {
      await db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added users.${name}`);
    }
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
    ON users(email)
    WHERE email IS NOT NULL;
  `);
}

module.exports = { applyUserAuthColumns };
