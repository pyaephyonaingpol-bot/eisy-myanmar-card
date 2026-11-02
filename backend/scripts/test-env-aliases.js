#!/usr/bin/env node
'use strict';

/**
 * Vercel-style env alias normalization (TRON_PRO_API_KEY / TRONGRID_API_KEY / TRON_API_KEY, TURSO_* vs DATABASE_*).
 * Run: node backend/scripts/test-env-aliases.js
 */
const assert = require('assert');

function snapshot(keys) {
  const out = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function restore(snap) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const keys = [
  'TRON_API_KEY',
  'TRONGRID_API_KEY',
  'TRON_PRO_API_KEY',
  'TRON_FULL_HOST',
  'TRONGRID_FULL_HOST',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'LIBSQL_URL',
  'DATABASE_AUTH_TOKEN',
  'TURSO_AUTH_TOKEN',
  'LIBSQL_AUTH_TOKEN',
];

const before = snapshot(keys);
try {
  for (const k of keys) delete process.env[k];
  process.env.TRON_API_KEY = 'vercel-tron-key';
  process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'turso-token';
  assert.strictEqual(process.env.DATABASE_URL, undefined);

  const { normalizePlatformEnvAliases } = require('../src/lib/envAliases');
  normalizePlatformEnvAliases();

  assert.strictEqual(process.env.TRON_PRO_API_KEY, 'vercel-tron-key');
  assert.strictEqual(process.env.TRONGRID_API_KEY, 'vercel-tron-key');
  assert.strictEqual(process.env.TRON_API_KEY, 'vercel-tron-key');
  assert.strictEqual(process.env.DATABASE_URL, 'libsql://example.turso.io');
  assert.strictEqual(process.env.DATABASE_AUTH_TOKEN, 'turso-token');

  let {
    tronApiKey,
    tronGridRequestHeaders,
    databaseUrl,
    databaseAuthToken,
  } = require('../src/lib/envAliases');
  assert.strictEqual(tronApiKey(), 'vercel-tron-key');
  assert.strictEqual(tronGridRequestHeaders()['TRON-PRO-API-KEY'], 'vercel-tron-key');
  assert.strictEqual(databaseUrl(), 'libsql://example.turso.io');
  assert.strictEqual(databaseAuthToken(), 'turso-token');

  for (const k of ['TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY']) delete process.env[k];
  process.env.TRON_PRO_API_KEY = 'pro-only-key';
  normalizePlatformEnvAliases();
  ({
    tronApiKey,
    tronGridRequestHeaders,
  } = require('../src/lib/envAliases'));
  assert.strictEqual(tronApiKey(), 'pro-only-key');
  assert.strictEqual(tronGridRequestHeaders()['TRON-PRO-API-KEY'], 'pro-only-key');

  for (const k of ['TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY']) delete process.env[k];
  process.env.TRONGRID_API_KEY = 'grid-only-key';
  normalizePlatformEnvAliases();
  ({
    tronApiKey,
    tronGridRequestHeaders,
  } = require('../src/lib/envAliases'));
  assert.strictEqual(tronApiKey(), 'grid-only-key');
  assert.strictEqual(tronGridRequestHeaders()['TRON-PRO-API-KEY'], 'grid-only-key');

  console.log('test-env-aliases: OK');
} finally {
  restore(before);
}
