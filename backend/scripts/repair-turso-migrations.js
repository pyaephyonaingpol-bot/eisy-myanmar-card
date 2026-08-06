require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { initDb, getDb, closeDb } = require('../src/db');
const { applyMigration } = require('../migrations/runner');

(async () => {
  await initDb();
  const db = getDb();

  const files = fs
    .readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.startsWith('000_'))
    .sort();

  const applied = await db.all('SELECT name FROM schema_migrations ORDER BY name');
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    try {
      await applyMigration(db, file);
    } catch (err) {
      const msg = String(err.message || err);
      if (/duplicate column name|already exists/i.test(msg)) {
        console.warn(`[repair] Marking ${file} as applied after benign error: ${msg}`);
        await db.run('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)', file);
        continue;
      }
      throw err;
    }
  }

  const { runMigrations } = require('../migrations/runner');
  const { applyUserAuthColumns } = require('../migrations/patches/applyUserAuthColumns');
  const { ensureAuthTables } = require('../migrations/patches/ensureAuthTables');
  const { columnExists } = require('../migrations/runner');

  await applyUserAuthColumns(db, columnExists);
  await ensureAuthTables(db);
  await runMigrations(db);

  const users = await db.get('SELECT COUNT(*) AS c FROM users');
  console.log('[repair] Done. users:', Number(users?.c || 0));
  await closeDb();
})().catch(async (err) => {
  console.error('[repair] Failed:', err.message);
  process.exit(1);
});
