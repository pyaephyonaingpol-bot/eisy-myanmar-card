#!/usr/bin/env node
'use strict';

/**
 * Vercel-style env alias normalization (TRON_API_KEY vs TRONGRID_API_KEY, TURSO_* vs DATABASE_*).
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

  assert.strictEqual(process.env.TRONGRID_API_KEY, 'vercel-tron-key');
  assert.strictEqual(process.env.TRON_API_KEY, 'vercel-tron-key');
  assert.strictEqual(process.env.DATABASE_URL, 'libsql://example.turso.io');
  assert.strictEqual(process.env.DATABASE_AUTH_TOKEN, 'turso-token');

  const { tronApiKey, databaseUrl, databaseAuthToken } = require('../src/lib/envAliases');
  assert.strictEqual(tronApiKey(), 'vercel-tron-key');
  assert.strictEqual(databaseUrl(), 'libsql://example.turso.io');
  assert.strictEqual(databaseAuthToken(), 'turso-token');

  console.log('test-env-aliases: OK');
} finally {
  restore(before);
}
