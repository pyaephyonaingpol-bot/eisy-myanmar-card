const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const { runMigrations, columnExists, tableExists } = require('../migrations/runner');
const { applyUserAuthColumns } = require('../migrations/patches/applyUserAuthColumns');
const { ensureAuthTables } = require('../migrations/patches/ensureAuthTables');

let db = null;

async function initDb() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'eisy.db');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');

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
    await db.close();
    db = null;
  }
}

module.exports = { initDb, getDb, closeDb };
