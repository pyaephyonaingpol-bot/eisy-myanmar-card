/**
 * Run migrations against local SQLite or remote Turso (when DATABASE_URL is set).
 *
 * Usage:
 *   npm run migrate
 *
 * Turso:
 *   set DATABASE_URL=libsql://your-db.turso.io
 *   set DATABASE_AUTH_TOKEN=your-token
 *   npm run migrate
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDatabaseInfo } = require('./db');

async function migrate() {
  console.log('[migrate] Database target:', getDatabaseInfo());
  await initDb();
  console.log('[migrate] Migrations complete.');
  await closeDb();
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
