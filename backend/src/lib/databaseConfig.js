const path = require('path');
const { isVercel, ensureDir } = require('../paths');
const { databaseUrl, databaseAuthToken } = require('./envAliases');

function readDatabaseUrl() {
  return databaseUrl();
}

function readDatabaseAuthToken() {
  return databaseAuthToken();
}

function isRemoteDatabaseUrl(url) {
  return /^libsql:/i.test(url) || /^https?:/i.test(url);
}

function isFileDatabaseUrl(url) {
  return /^file:/i.test(url);
}

function isTursoLikeUrl(url) {
  const u = String(url || '');
  if (!u) return false;
  if (/turso\.io/i.test(u)) return true;
  if (/^libsql:/i.test(u)) return true;
  if (/^https?:\/\//i.test(u) && /libsql|turso/i.test(u)) return true;
  return isRemoteDatabaseUrl(u);
}

/**
 * Driver selection:
 * - Default: @libsql/client (file locally; Turso remote when URL + token set)
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

function resolveLocalDatabasePath(configuredUrl) {
  if (configuredUrl && isFileDatabaseUrl(configuredUrl)) {
    const raw = configuredUrl.replace(/^file:/i, '');
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  }

  const dataDir = isVercel
    ? path.join('/tmp', 'eisy-data')
    : path.join(__dirname, '..', '..', 'data');
  ensureDir(dataDir);
  return path.join(dataDir, 'eisy.db');
}

/**
 * Prefer remote Turso/LibSQL when DATABASE_URL / TURSO_DATABASE_URL is a remote URL
 * and an auth token is available. Otherwise use an embedded local file DB.
 *
 * On Vercel, a remote URL without a token fails fast (DATABASE_AUTH_TOKEN_MISSING)
 * so operators get a clear signal — light API paths still answer during bootstrap
 * failure to avoid SPA /api/client-errors cascades.
 */
function getDatabaseConfig() {
  const url = readDatabaseUrl();
  const authToken = readDatabaseAuthToken();
  const driver = resolveDriver();

  if (url && isRemoteDatabaseUrl(url) && !isFileDatabaseUrl(url)) {
    if (!authToken) {
      const err = new Error(
        'TURSO_AUTH_TOKEN (or DATABASE_AUTH_TOKEN / LIBSQL_AUTH_TOKEN) is required when '
        + 'DATABASE_URL / TURSO_DATABASE_URL is a remote libsql:// Turso URL'
      );
      err.code = 'DATABASE_AUTH_TOKEN_MISSING';
      throw err;
    }
    return {
      mode: 'libsql',
      driver: 'libsql',
      url,
      authToken,
      persistent: true,
      turso: true,
      warning: null,
      filePath: null,
    };
  }

  const filePath = resolveLocalDatabasePath(url);
  const persistent = !isVercel || isFileDatabaseUrl(url);

  if (driver === 'sqlite3') {
    return {
      mode: 'sqlite-file',
      driver: 'sqlite3',
      filePath,
      persistent: true,
      turso: false,
      warning: null,
    };
  }

  let warning = null;
  if (isVercel && !isFileDatabaseUrl(url || '')) {
    const isProd = process.env.VERCEL_ENV === 'production';
    warning = isProd
      ? 'No Turso DATABASE_URL on Vercel production — using ephemeral /tmp LibSQL. '
        + 'Set DATABASE_URL or TURSO_DATABASE_URL (libsql://…) plus TURSO_AUTH_TOKEN '
        + '(or DATABASE_AUTH_TOKEN) for persistent data.'
      : 'No remote DATABASE_URL — using ephemeral /tmp LibSQL file DB for this preview.';
  }

  return {
    mode: 'libsql',
    driver: 'libsql',
    url: `file:${filePath}`,
    authToken: undefined,
    persistent,
    turso: false,
    warning,
    filePath,
  };
}

function getDatabaseInfo() {
  try {
    const config = getDatabaseConfig();
    if (config.mode === 'libsql') {
      return {
        mode: config.mode,
        driver: config.driver,
        url: String(config.url || '').replace(/\/\/[^@]+@/, '//***@'),
        filePath: config.filePath || null,
        persistent: config.persistent,
        warning: config.warning,
        turso: Boolean(config.turso),
      };
    }
    return {
      mode: config.mode,
      driver: config.driver,
      filePath: config.filePath,
      persistent: config.persistent,
      warning: config.warning,
      turso: false,
    };
  } catch (err) {
    // Safe for bootstrap diagnostics when remote URL is set without a token.
    return {
      mode: null,
      driver: null,
      url: null,
      filePath: null,
      persistent: null,
      warning: null,
      turso: isTursoLikeUrl(readDatabaseUrl()),
      error_code: err?.code || null,
      error_message: String(err?.message || err).slice(0, 400),
    };
  }
}

module.exports = {
  readDatabaseUrl,
  readDatabaseAuthToken,
  resolveLocalDatabasePath: () => resolveLocalDatabasePath(readDatabaseUrl()),
  getDatabaseConfig,
  getDatabaseInfo,
  isRemoteDatabaseUrl,
  isTursoLikeUrl,
  resolveDriver,
};
