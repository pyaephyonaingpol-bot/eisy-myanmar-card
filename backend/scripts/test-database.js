/**
 * Verify the local embedded LibSQL/SQLite database opens and migrates.
 * Usage (from backend/):
 *   npm run db:test
 *
 * Optional: DATABASE_URL=file:./data/eisy.db
 * Turso / remote libsql:// URLs are ignored by databaseConfig.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDatabaseInfo } = require('../src/db');

(async () => {
  const info = getDatabaseInfo();
  console.log('[db:test] Target:', info);

  if (info.turso) {
    console.error('[db:test] Unexpected turso=true — Turso must not be used.');
    process.exit(1);
  }

  await initDb();
  const { getDb } = require('../src/db');
  const db = getDb();
  const users = await db.get('SELECT COUNT(*) AS c FROM users');
  console.log('[db:test] Connected successfully.');
  console.log('[db:test] users table rows:', Number(users?.c || 0));
  await closeDb();
})().catch((err) => {
  console.error('[db:test] Failed:', err.message);
  process.exit(1);
});
