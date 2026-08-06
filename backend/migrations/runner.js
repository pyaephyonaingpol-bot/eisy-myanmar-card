const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname);

async function ensureMigrationsTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function getAppliedMigrations(db) {
  const rows = await db.all('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(db, filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');
  const isLibsql = Boolean(db.isLibsql);
  const needsFkOff = !isLibsql && /PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql);
  const sqlBody = sql
    .replace(/PRAGMA\s+foreign_keys\s*=\s*OFF;?\s*/gi, '')
    .replace(/PRAGMA\s+foreign_keys\s*=\s*ON;?\s*/gi, '');

  if (isLibsql) {
    await db.exec(sqlBody);
    await db.run('INSERT INTO schema_migrations (name) VALUES (?)', filename);
    console.log(`[migrate] Applied ${filename}`);
    return;
  }

  if (needsFkOff) {
    await db.exec('PRAGMA foreign_keys=OFF');
    try {
      await db.exec(sqlBody);
      await db.run('INSERT INTO schema_migrations (name) VALUES (?)', filename);
      console.log(`[migrate] Applied ${filename}`);
    } catch (err) {
      throw new Error(`Migration ${filename} failed: ${err.message}`);
    } finally {
      await db.exec('PRAGMA foreign_keys=ON');
    }
    return;
  }

  await db.exec('BEGIN');
  try {
    await db.exec(sqlBody);
    await db.run('INSERT INTO schema_migrations (name) VALUES (?)', filename);
    await db.exec('COMMIT');
    console.log(`[migrate] Applied ${filename}`);
  } catch (err) {
    await db.exec('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  }
}

async function columnExists(db, table, column) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function tableExists(db, table) {
  const row = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return Boolean(row);
}

async function runMigrations(db) {
  await ensureMigrationsTable(db);
  const applied = await getAppliedMigrations(db);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.startsWith('000_'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    await applyMigration(db, file);
    count++;
  }
  if (count === 0) {
    console.log('[migrate] All migrations already applied');
  } else {
    console.log(`[migrate] Applied ${count} new migration(s)`);
  }

  const usersOk = await tableExists(db, 'users');
  if (!usersOk) {
    console.warn('[migrate] users table missing after migrations — resetting migration state');
    await db.exec('DELETE FROM schema_migrations');
    for (const file of files) {
      await applyMigration(db, file);
    }
  }
}

module.exports = {
  runMigrations,
  columnExists,
  tableExists,
};
