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
  const config = getDatabaseConfig();

  if (config.mode === 'libsql') {
    const { createClient } = require('@libsql/client');
    const fetchTimeoutMs = Math.max(
      2000,
      parseInt(process.env.LIBSQL_FETCH_TIMEOUT_MS || '15000', 10) || 15000
    );
    const concurrency = Math.max(
      1,
      Math.min(32, parseInt(process.env.LIBSQL_CONCURRENCY || '8', 10) || 8)
    );
    const clientOpts = {
      url: config.url,
      authToken: config.authToken,
      intMode: 'number',
      concurrency,
    };
    // Bound each Turso HTTP round-trip so a hung connection cannot sit until
    // the Vercel gateway emits opaque HTTP 504.
    if (typeof globalThis.fetch === 'function' && !String(config.url).startsWith('file:')) {
      clientOpts.fetch = (input, init = {}) => {
        const timeout = AbortSignal.timeout(fetchTimeoutMs);
        const signal = init.signal
          ? AbortSignal.any([init.signal, timeout])
          : timeout;
        return globalThis.fetch(input, { ...init, signal });
      };
    }
    const client = createClient(clientOpts);
    db = createLibsqlDb(client);
    if (String(config.url).startsWith('file:')) {
      console.log('[db] Connected to LibSQL file database:', config.filePath || config.url);
    } else {
      console.log('[db] Connected to persistent LibSQL / Turso database', {
        concurrency,
        fetchTimeoutMs,
      });
    }
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
  await runMigrations(db);
  await applyUserAuthColumns(db, columnExists);
  await ensureAuthTables(db);
  await ensureMmkWithdrawalColumns(db, columnExists, tableExists);
  await ensureUsdtWithdrawalProofColumns(db, columnExists, tableExists);
  await ensurePagoCardColumns(db, columnExists, tableExists);
  await ensurePago3dsEventsTable(db, tableExists);

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
