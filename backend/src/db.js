const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { runMigrations, columnExists, tableExists } = require('../migrations/runner');
const { applyUserAuthColumns } = require('../migrations/patches/applyUserAuthColumns');
const { ensureAuthTables } = require('../migrations/patches/ensureAuthTables');
const { createLibsqlDb } = require('./lib/libsqlDb');
const { getDatabaseConfig, getDatabaseInfo } = require('./lib/databaseConfig');

let db = null;

async function initDb() {
  const config = getDatabaseConfig();

  if (config.mode === 'libsql') {
    const { createClient } = require('@libsql/client');
    const client = createClient({
      url: config.url,
      authToken: config.authToken,
    });
    db = createLibsqlDb(client);
    console.log('[db] Connected to persistent LibSQL database');
  } else {
    db = await open({
      filename: config.filePath,
      driver: sqlite3.Database,
    });
    console.log('[db] Using SQLite file:', config.filePath);
    if (config.warning) {
      console.warn('[db]', config.warning);
    }
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');
  }

  console.log('[db] Running migrations...');
  await runMigrations(db);
  await applyUserAuthColumns(db, columnExists);
  await ensureAuthTables(db);

  try {
    const { migrateAllLegacyUsdBalances } = require('./services/walletService');
    await migrateAllLegacyUsdBalances();
  } catch (err) {
    console.warn('[db] Legacy USD migration skipped:', err.message);
  }

  const tables = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  console.log('[db] Tables ready:', tables.map((t) => t.name).join(', '));

  const userCount = await db.get('SELECT COUNT(*) AS c FROM users');
  console.log('[db] User count:', Number(userCount?.c || 0));

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

async function closeDb() {
  if (db) {
    if (typeof db.close === 'function') {
      await db.close();
    }
    db = null;
  }
}

module.exports = { initDb, getDb, closeDb, getDatabaseInfo };
