const { runMigrations, columnExists, tableExists } = require('../migrations/runner');
const { applyUserAuthColumns } = require('../migrations/patches/applyUserAuthColumns');
const { ensureAuthTables } = require('../migrations/patches/ensureAuthTables');
const { ensureMmkWithdrawalColumns } = require('../migrations/patches/ensureMmkWithdrawalColumns');
const { ensureUsdtWithdrawalProofColumns } = require('../migrations/patches/ensureUsdtWithdrawalProofColumns');
const { ensurePagoCardColumns } = require('../migrations/patches/ensurePagoCardColumns');
const { ensurePago3dsEventsTable } = require('../migrations/patches/ensurePago3dsEventsTable');
const { createLibsqlDb } = require('./lib/libsqlDb');
const { getDatabaseConfig, getDatabaseInfo } = require('./lib/databaseConfig');

let db = null;

async function openLegacySqlite3(filePath) {
  // Loaded only when SQLITE_DRIVER=sqlite3 (never on Vercel).
  // Dynamic path string keeps native sqlite3 out of serverless traces.
  const driverPath = ['./lib/', 'sqlite3', 'Driver'].join('');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { openSqliteFile } = require(driverPath);
  return openSqliteFile(filePath);
}

async function initDb() {
  if (db) return db;
  let config;
  try {
    config = getDatabaseConfig();
  } catch (err) {
    err.code = err.code || 'DATABASE_CONFIG_INVALID';
    console.error('[db] config failed:', {
      code: err.code,
      message: err.message,
      turso: false,
    });
    throw err;
  }

  if (config.mode === 'libsql') {
    const { createClient } = require('@libsql/client');
    const concurrency = Math.max(
      1,
      Math.min(32, parseInt(process.env.LIBSQL_CONCURRENCY || '8', 10) || 8)
    );
    // Embedded file DB only — no remote Turso / libsql:// client.
    const clientOpts = {
      url: config.url,
      intMode: 'number',
      concurrency,
    };
    try {
      const client = createClient(clientOpts);
      db = createLibsqlDb(client);
    } catch (err) {
      err.code = err.code || 'LIBSQL_CLIENT_INIT_FAILED';
      console.error('[db] LibSQL file client init failed:', {
        code: err.code,
        message: String(err.message || err).slice(0, 400),
        filePath: config.filePath || null,
        url: String(config.url || '').slice(0, 120),
      });
      throw err;
    }
    console.log('[db] Connected to LibSQL file database:', config.filePath || config.url);
  } else if (config.mode === 'sqlite-file') {
    db = await openLegacySqlite3(config.filePath);
    console.log('[db] Using legacy native SQLite file:', config.filePath);
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');
  } else {
    throw new Error(`Unsupported database mode: ${config.mode}`);
  }

  if (config.warning) {
    console.warn('[db]', config.warning);
  }

  console.log('[db] Running migrations...');
  try {
    await runMigrations(db);
  } catch (err) {
    err.code = err.code || 'DB_MIGRATION_FAILED';
    console.error('[db] migrations failed:', {
      code: err.code,
      message: String(err.message || err).slice(0, 400),
    });
    // Reset so the next cold start can retry with a fixed config.
    try { await db?.close?.(); } catch (_) { /* ignore */ }
    db = null;
    throw err;
  }
  try {
    await applyUserAuthColumns(db, columnExists);
    await ensureAuthTables(db);
    await ensureMmkWithdrawalColumns(db, columnExists, tableExists);
    await ensureUsdtWithdrawalProofColumns(db, columnExists, tableExists);
    await ensurePagoCardColumns(db, columnExists, tableExists);
    await ensurePago3dsEventsTable(db, tableExists);
  } catch (err) {
    err.code = err.code || 'DB_PATCH_FAILED';
    console.error('[db] schema patches failed:', {
      code: err.code,
      message: String(err.message || err).slice(0, 400),
    });
    try { await db?.close?.(); } catch (_) { /* ignore */ }
    db = null;
    throw err;
  }

  // Defer non-critical housekeeping so auth / admin list APIs are not blocked
  // on cold start (a common path into gateway HTTP 504).
  const bootDb = db;
  setImmediate(() => {
    if (db !== bootDb) return;
    Promise.resolve()
      .then(async () => {
        try {
          const { migrateAllLegacyUsdBalances } = require('./services/walletService');
          await migrateAllLegacyUsdBalances();
        } catch (err) {
          console.warn('[db] Legacy USD migration skipped:', err.message);
        }
      })
      .catch((err) => {
        console.warn('[db] deferred boot work failed:', err.message);
      });
  });

  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    console.log('[db] Tables ready:', tables.map((t) => t.name).join(', '));
  }

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
