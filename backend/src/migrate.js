/**
 * Run migrations against local SQLite/LibSQL file or remote Turso.
 *
 * Usage:
 *   npm run migrate
 *
 * Turso:
 *   DATABASE_URL=libsql://your-db.turso.io   (or TURSO_DATABASE_URL)
 *   TURSO_AUTH_TOKEN=your-token             (or DATABASE_AUTH_TOKEN)
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
