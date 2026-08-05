require('dotenv').config();
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const { runMigrations, columnExists } = require('../migrations/runner');
const { applyUserAuthColumns } = require('../migrations/patches/applyUserAuthColumns');
const { ensureAuthTables } = require('../migrations/patches/ensureAuthTables');

async function migrate() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'eisy.db');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  await db.exec('PRAGMA foreign_keys = ON');

  console.log('[migrate] Running SQL migrations...');
  await runMigrations(db);

  console.log('[migrate] Applying user auth column patches...');
  await applyUserAuthColumns(db, columnExists);

  console.log('[migrate] Ensuring auth tables exist...');
  await ensureAuthTables(db);

  const applied = await db.all('SELECT name, applied_at FROM schema_migrations ORDER BY name');
  console.log('\n[migrate] Applied migrations:');
  applied.forEach((r) => console.log(`  - ${r.name} (${r.applied_at})`));

  await db.close();
  console.log('\n[migrate] Done.');
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
