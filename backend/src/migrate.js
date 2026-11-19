/**
 * Run migrations against the local embedded LibSQL/SQLite file database.
 *
 * Usage:
 *   npm run migrate
 *
 * Optional:
 *   DATABASE_URL=file:./data/eisy.db
 *
 * Turso / remote libsql:// URLs are ignored — this app does not use Turso.
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
