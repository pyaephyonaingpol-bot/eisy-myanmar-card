/**
 * Verify database connectivity (Turso remote or local LibSQL file).
 * Usage (from backend/):
 *   npm run db:test
 *
 * Turso:
 *   DATABASE_URL=libsql://…   (or TURSO_DATABASE_URL)
 *   TURSO_AUTH_TOKEN=…        (or DATABASE_AUTH_TOKEN)
 *
 * Local file:
 *   DATABASE_URL=file:./data/eisy.db   (or leave unset)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDatabaseInfo } = require('../src/db');

(async () => {
  const info = getDatabaseInfo();
  console.log('[db:test] Target:', info);

  if (info.error_code) {
    console.error('[db:test] Config error:', info.error_code, info.error_message);
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
