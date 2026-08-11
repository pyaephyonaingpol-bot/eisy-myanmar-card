const path = require('path');
const fs = require('fs');
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

function preferLibsqlFileDriver() {
  const forced = String(process.env.SQLITE_DRIVER || '').trim().toLowerCase();
  if (forced === 'libsql' || forced === 'libsql-file') return true;
  if (forced === 'sqlite3' || forced === 'sqlite') return false;
  // Native sqlite3 is unreliable on Vercel serverless — use embedded LibSQL instead.
  return isVercel;
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

  if (url && isRemoteDatabaseUrl(url)) {
    return {
      mode: 'libsql',
      url,
      authToken: authToken || undefined,
      persistent: true,
      warning: null,
    };
  }

  const filePath = resolveLocalDatabasePath();
  const persistent = !isVercel || isFileDatabaseUrl(url);

  if (preferLibsqlFileDriver()) {
    let warning = null;
    if (isVercel && !(url && isRemoteDatabaseUrl(url))) {
      warning = 'DATABASE_URL is not set — using ephemeral /tmp LibSQL file DB. '
        + 'Set DATABASE_URL (libsql://…) + DATABASE_AUTH_TOKEN for persistent Turso storage.';
    }
    return {
      mode: 'libsql',
      url: `file:${filePath}`,
      authToken: undefined,
      persistent,
      warning,
      filePath,
    };
  }

  let warning = null;
  if (isVercel && !url) {
    warning = 'DATABASE_URL is not set — using ephemeral /tmp SQLite. Users and sessions are lost when Vercel spins up a new instance.';
  }

  return {
    mode: 'sqlite-file',
    filePath,
    persistent,
    warning,
  };
}

function getDatabaseInfo() {
  const config = getDatabaseConfig();
  if (config.mode === 'libsql') {
    return {
      mode: config.mode,
      url: String(config.url || '').replace(/\/\/[^@]+@/, '//***@'),
      filePath: config.filePath || null,
      persistent: config.persistent,
      warning: config.warning,
    };
  }
  return {
    mode: config.mode,
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
  preferLibsqlFileDriver,
};
