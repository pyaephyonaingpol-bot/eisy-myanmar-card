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
      url: config.url.replace(/\/\/[^@]+@/, '//***@'),
      persistent: true,
      warning: null,
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
};
