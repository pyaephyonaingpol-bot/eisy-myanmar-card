const path = require('path');
const { isVercel, ensureDir } = require('../paths');
const { firstEnv } = require('./envAliases');

function readConfiguredDatabaseUrl() {
  // Prefer an explicit local file URL only. Remote Turso / LibSQL HTTP URLs are ignored.
  return firstEnv('DATABASE_URL', 'LIBSQL_URL');
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
 * - Default: embedded @libsql/client against a local file (no Turso cloud)
 * - Legacy override: SQLITE_DRIVER=sqlite3 (optional; not supported on Vercel)
 */
function resolveDriver() {
  const forced = String(process.env.SQLITE_DRIVER || '').trim().toLowerCase();
  if (forced === 'sqlite3' || forced === 'sqlite') {
    if (isVercel) {
      console.warn('[db] SQLITE_DRIVER=sqlite3 is ignored on Vercel — using embedded LibSQL file');
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
 * Primary DB is always a local embedded SQLite/LibSQL file.
 * Turso cloud is not used — leftover TURSO_* / remote DATABASE_URL env vars are ignored.
 */
function getDatabaseConfig() {
  const configuredUrl = readConfiguredDatabaseUrl();
  const tursoUrl = firstEnv('TURSO_DATABASE_URL');
  const driver = resolveDriver();

  let warning = null;
  let effectiveUrl = configuredUrl;

  const configuredIsRemote = Boolean(
    configuredUrl && isTursoLikeUrl(configuredUrl) && !isFileDatabaseUrl(configuredUrl)
  );
  const leftoverTurso = Boolean(tursoUrl);

  if (configuredIsRemote || leftoverTurso) {
    warning = 'Turso / remote LibSQL env is configured but ignored — this app uses a local embedded DB file only. '
      + 'Remove TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, DATABASE_AUTH_TOKEN, and any libsql:// DATABASE_URL from env.';
    console.warn('[db]', warning);
    // Drop remote URLs only; keep an explicit local file: DATABASE_URL.
    if (configuredIsRemote || !isFileDatabaseUrl(configuredUrl || '')) {
      effectiveUrl = '';
    }
  }

  const filePath = resolveLocalDatabasePath(effectiveUrl && isFileDatabaseUrl(effectiveUrl) ? effectiveUrl : '');
  const persistent = !isVercel || Boolean(effectiveUrl && isFileDatabaseUrl(effectiveUrl));

  if (driver === 'sqlite3') {
    return {
      mode: 'sqlite-file',
      driver: 'sqlite3',
      filePath,
      persistent: true,
      warning,
    };
  }

  if (isVercel && !persistent) {
    warning = (warning ? `${warning} ` : '')
      + 'Vercel uses ephemeral /tmp LibSQL — data does not survive cold starts. '
      + 'Run the durable API on the Droplet (PM2) or set DATABASE_URL=file:/path/on/persistent/volume.';
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
      turso: false,
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
}

module.exports = {
  readDatabaseUrl: readConfiguredDatabaseUrl,
  readDatabaseAuthToken: () => '',
  resolveLocalDatabasePath: () => resolveLocalDatabasePath(readConfiguredDatabaseUrl()),
  getDatabaseConfig,
  getDatabaseInfo,
  isRemoteDatabaseUrl,
  isTursoLikeUrl,
  resolveDriver,
};
