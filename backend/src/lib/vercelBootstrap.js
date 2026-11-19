/**
 * Helpers for the Vercel serverless Express entry (backend/api/index.js).
 * Keeps bootstrap diagnostics free of secrets and identifies "light" routes
 * that can answer without a ready database.
 */

'use strict';

function normalizePath(url) {
  const raw = String(url || '').split('?')[0] || '';
  if (!raw) return '/';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Routes that must stay available when DB bootstrap fails so the SPA
 * does not cascade-report into /api/client-errors forever.
 */
function isBootstrapLightPath(url) {
  const p = normalizePath(url);
  return p === '/api/config/monitoring'
    || p === '/api/client-errors'
    || p === '/api/health'
    || p === '/health';
}

function redactUrl(url) {
  return String(url || '')
    .replace(/\/\/([^/@\s]+)@/g, '//***@')
    .replace(/([?&](token|auth|key|secret|password)=)[^&]*/gi, '$1***');
}

function safeBootstrapDiagnostics(err) {
  let db = null;
  try {
    const { getDatabaseInfo } = require('./databaseConfig');
    db = getDatabaseInfo();
  } catch (_) {
    db = null;
  }

  return {
    vercel_env: process.env.VERCEL_ENV || null,
    node_env: process.env.NODE_ENV || null,
    turso: false,
    db_mode: db?.mode || null,
    db_driver: db?.driver || null,
    db_persistent: db?.persistent ?? null,
    db_file: db?.filePath || null,
    db_url: db?.url ? redactUrl(db.url) : null,
    db_warning: db?.warning || null,
    error_code: err?.code || err?.name || null,
    error_message: String(err?.message || err || 'bootstrap failed').slice(0, 400),
  };
}

function logBootstrapFailure(err, req) {
  const path = normalizePath(req?.url || req?.originalUrl || '');
  const method = String(req?.method || '').toUpperCase() || 'UNKNOWN';
  const diagnostics = safeBootstrapDiagnostics(err);
  console.error('[vercel] bootstrap failed', {
    method,
    path,
    ...diagnostics,
  });
  if (err?.stack) {
    console.error('[vercel] bootstrap stack:', String(err.stack).split('\n').slice(0, 8).join('\n'));
  }
  return diagnostics;
}

module.exports = {
  normalizePath,
  isBootstrapLightPath,
  redactUrl,
  safeBootstrapDiagnostics,
  logBootstrapFailure,
};
