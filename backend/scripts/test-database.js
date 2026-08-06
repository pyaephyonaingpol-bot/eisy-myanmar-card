/**
 * Verify DATABASE_URL / DATABASE_AUTH_TOKEN connectivity.
 * Usage (from backend/):
 *   set DATABASE_URL=libsql://...
 *   set DATABASE_AUTH_TOKEN=...
 *   npm run db:test
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDatabaseInfo } = require('../src/db');

(async () => {
  const info = getDatabaseInfo();
  console.log('[db:test] Target:', info);

  if (info.mode !== 'libsql') {
    console.error('[db:test] DATABASE_URL is not set to a libsql/https remote URL.');
    console.error('Set DATABASE_URL and DATABASE_AUTH_TOKEN, then retry.');
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
