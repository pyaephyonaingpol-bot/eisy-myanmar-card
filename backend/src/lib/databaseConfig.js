const path = require('path');
const { isVercel, ensureDir } = require('../paths');

function readDatabaseUrl() {
  return (
    process.env.DATABASE_URL
    || process.env.TURSO_DATABASE_URL
    || ''
  ).trim();
}

function readDatabaseAuthToken() {
  return (
    process.env.DATABASE_AUTH_TOKEN
    || process.env.TURSO_AUTH_TOKEN
    || ''
  ).trim();
}

function isRemoteDatabaseUrl(url) {
  return /^libsql:/i.test(url) || /^https?:/i.test(url);
}

function isFileDatabaseUrl(url) {
  return /^file:/i.test(url);
}

/**
 * Driver selection:
 * - Default (local + Vercel): @libsql/client — Vercel-compatible, no native sqlite3
 * - Legacy override: SQLITE_DRIVER=sqlite3 (optional; not supported on Vercel)
 */
function resolveDriver() {
  const forced = String(process.env.SQLITE_DRIVER || '').trim().toLowerCase();
  if (forced === 'sqlite3' || forced === 'sqlite') {
    if (isVercel) {
      console.warn('[db] SQLITE_DRIVER=sqlite3 is ignored on Vercel — using LibSQL');
      return 'libsql';
    }
    return 'sqlite3';
  }
  return 'libsql';
}

function resolveLocalDatabasePath() {
  const url = readDatabaseUrl();
  if (isFileDatabaseUrl(url)) {
    const raw = url.replace(/^file:/i, '');
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  }

  const dataDir = isVercel
    ? path.join('/tmp', 'eisy-data')
    : path.join(__dirname, '..', '..', 'data');
  ensureDir(dataDir);
  return path.join(dataDir, 'eisy.db');
}

function getDatabaseConfig() {
  const url = readDatabaseUrl();
  const authToken = readDatabaseAuthToken();
  const driver = resolveDriver();

  // Remote Turso / LibSQL (preferred for Vercel production)
  if (url && isRemoteDatabaseUrl(url)) {
    return {
      mode: 'libsql',
      driver: 'libsql',
      url,
      authToken: authToken || undefined,
      persistent: true,
      warning: null,
    };
  }

  const filePath = resolveLocalDatabasePath();
  const persistent = !isVercel || isFileDatabaseUrl(url);

  // Legacy local-only native sqlite3
  if (driver === 'sqlite3') {
    return {
      mode: 'sqlite-file',
      driver: 'sqlite3',
      filePath,
      persistent: true,
      warning: null,
    };
  }

  // Default: LibSQL embedded file (local) or ephemeral /tmp on Vercel without DATABASE_URL
  let warning = null;
  if (isVercel && !(url && isRemoteDatabaseUrl(url))) {
    const isProd = process.env.VERCEL_ENV === 'production';
    warning = isProd
      ? 'DATABASE_URL is not set on Vercel production — using ephemeral /tmp LibSQL. '
        + 'Set DATABASE_URL (libsql://…) + DATABASE_AUTH_TOKEN (Turso) for persistent fintech data.'
      : 'DATABASE_URL is not set — using ephemeral /tmp LibSQL file DB for this preview.';
  }

  return {
    mode: 'libsql',
    driver: 'libsql',
    url: `file:${filePath}`,
    authToken: undefined,
    persistent,
    warning,
    filePath,
  };
}

function getDatabaseInfo() {
  const config = getDatabaseConfig();
  if (config.mode === 'libsql') {
    return {
      mode: config.mode,
      driver: config.driver,
      url: String(config.url || '').replace(/\/\/[^@]+@/, '//***@'),
      filePath: config.filePath || null,
      persistent: config.persistent,
      warning: config.warning,
    };
  }
  return {
    mode: config.mode,
    driver: config.driver,
    filePath: config.filePath,
    persistent: config.persistent,
    warning: config.warning,
  };
}

module.exports = {
  readDatabaseUrl,
  readDatabaseAuthToken,
  resolveLocalDatabasePath,
  getDatabaseConfig,
  getDatabaseInfo,
  isRemoteDatabaseUrl,
  resolveDriver,
};
