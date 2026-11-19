#!/usr/bin/env node
/**
 * Vercel serverless bootstrap — Turso when configured; cascade-safe on failure.
 * Run: node backend/scripts/test-vercel-bootstrap.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function clearDbRelatedCache() {
  const targets = [
    '../src/lib/databaseConfig',
    '../src/lib/vercelBootstrap',
    '../src/lib/envAliases',
    '../src/paths',
    '../src/db',
    '../api/index.js',
  ];
  for (const rel of targets) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch (_) { /* ignore */ }
  }
}

function testLightPathHelpers() {
  section('isBootstrapLightPath + diagnostics');
  const {
    isBootstrapLightPath,
    redactUrl,
    safeBootstrapDiagnostics,
  } = require('../src/lib/vercelBootstrap');

  assert.strictEqual(isBootstrapLightPath('/api/config/monitoring'), true);
  assert.strictEqual(isBootstrapLightPath('/api/client-errors?x=1'), true);
  assert.strictEqual(isBootstrapLightPath('/api/tron/wallet/address'), false);
  assert.strictEqual(
    redactUrl('libsql://user:secret@host.turso.io/db'),
    'libsql://***@host.turso.io/db'
  );

  const diag = safeBootstrapDiagnostics(new Error('boot boom'));
  assert.strictEqual(diag.error_message, 'boot boom');
  assert.ok('has_database_url' in diag);
  assert.ok('has_database_auth_token' in diag);
  console.log('ok');
}

function testWiring() {
  section('Entry + client cascade guards wired');
  const apiSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiSrc.includes('BOOTSTRAP_FAILED'));
  assert.ok(apiSrc.includes('isBootstrapLightPath'));
  assert.ok(apiSrc.includes('hasDatabaseUrl') || apiSrc.includes('has_database_url'));
  assert.ok(!/BACKEND_URL|NEXT_PUBLIC_API_URL/.test(apiSrc), 'not an HTTP proxy to Droplet');

  const clientSrc = fs.readFileSync(path.join(__dirname, '../public/errorMonitor.js'), 'utf8');
  assert.ok(clientSrc.includes('shouldSkipServerIngest'));
  assert.ok(clientSrc.includes('BOOTSTRAP_FAILED'));

  const ingestSrc = fs.readFileSync(path.join(__dirname, '../src/routes/clientErrors.js'), 'utf8');
  assert.ok(ingestSrc.includes('skipped cascade ingest'));

  const dbCfg = fs.readFileSync(path.join(__dirname, '../src/lib/databaseConfig.js'), 'utf8');
  assert.ok(dbCfg.includes('DATABASE_AUTH_TOKEN_MISSING'));
  assert.ok(dbCfg.includes('TURSO_AUTH_TOKEN'));
  console.log('ok');
}

function testTursoConfig() {
  section('Turso remote config requires auth token');
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.TURSO_DATABASE_URL = 'libsql://demo-db.turso.io';
  delete process.env.DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.LIBSQL_AUTH_TOKEN;

  clearDbRelatedCache();
  const { getDatabaseConfig, getDatabaseInfo, isTursoLikeUrl } = require('../src/lib/databaseConfig');
  assert.strictEqual(isTursoLikeUrl('libsql://x.turso.io'), true);

  let threw = null;
  try {
    getDatabaseConfig();
  } catch (err) {
    threw = err;
  }
  assert.ok(threw, 'missing token must throw');
  assert.strictEqual(threw.code, 'DATABASE_AUTH_TOKEN_MISSING');

  const info = getDatabaseInfo();
  assert.strictEqual(info.turso, true);
  assert.strictEqual(info.error_code, 'DATABASE_AUTH_TOKEN_MISSING');

  process.env.TURSO_AUTH_TOKEN = 'test-token-value';
  clearDbRelatedCache();
  const { getDatabaseConfig: getCfg2 } = require('../src/lib/databaseConfig');
  const cfg = getCfg2();
  assert.strictEqual(cfg.mode, 'libsql');
  assert.strictEqual(cfg.turso, true);
  assert.strictEqual(cfg.url, 'libsql://demo-db.turso.io');
  assert.strictEqual(cfg.authToken, 'test-token-value');
  assert.strictEqual(cfg.persistent, true);

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearDbRelatedCache();
  console.log('ok');
}

async function testDegradedLightPaths() {
  section('Light paths stay up when Turso token missing');
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    LIBSQL_URL: process.env.LIBSQL_URL,
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = 'libsql://missing-token.turso.io';
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.LIBSQL_URL;
  delete process.env.LIBSQL_AUTH_TOKEN;

  clearDbRelatedCache();
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/index')];

  const appHandler = require('../api/index.js');
  const server = http.createServer((req, res) => {
    Promise.resolve(appHandler(req, res)).catch((err) => {
      console.error(err);
      res.statusCode = 500;
      res.end('fail');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const mon = await fetch(`http://127.0.0.1:${port}/api/config/monitoring`);
  assert.strictEqual(mon.status, 200);
  const monBody = await mon.json();
  assert.ok('enabled' in monBody);

  const ingest = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Server bootstrap failed',
      code: 'BOOTSTRAP_FAILED',
      path: '/api/tron/wallet/address',
      status: 503,
    }),
  });
  assert.strictEqual(ingest.status, 204);

  const wallet = await fetch(`http://127.0.0.1:${port}/api/tron/wallet/address`);
  assert.strictEqual(wallet.status, 503);
  const walletBody = await wallet.json();
  assert.strictEqual(walletBody.code, 'BOOTSTRAP_FAILED');
  assert.strictEqual(walletBody.diagnostics?.error_code, 'DATABASE_AUTH_TOKEN_MISSING');
  assert.strictEqual(walletBody.diagnostics?.has_database_url, true);
  assert.strictEqual(walletBody.diagnostics?.has_database_auth_token, false);

  await new Promise((resolve) => server.close(resolve));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearDbRelatedCache();
  console.log('ok');
}

async function testFileBootStillWorks() {
  section('Local file DB still boots without Turso');
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    LIBSQL_URL: process.env.LIBSQL_URL,
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  const tmpDb = path.join(os.tmpdir(), `eisy-file-${Date.now()}.db`);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = `file:${tmpDb}`;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.LIBSQL_URL;
  delete process.env.LIBSQL_AUTH_TOKEN;

  clearDbRelatedCache();
  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/index')];

  const appHandler = require('../api/index.js');
  const server = http.createServer((req, res) => {
    Promise.resolve(appHandler(req, res)).catch((err) => {
      console.error(err);
      res.statusCode = 500;
      res.end('fail');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const mon = await fetch(`http://127.0.0.1:${port}/api/config/monitoring`);
  assert.strictEqual(mon.status, 200);

  const wallet = await fetch(`http://127.0.0.1:${port}/api/tron/wallet/address`);
  assert.notStrictEqual(wallet.status, 503);

  await new Promise((resolve) => server.close(resolve));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearDbRelatedCache();
  try { fs.unlinkSync(tmpDb); } catch (_) { /* ignore */ }
  console.log('ok');
}

async function main() {
  testLightPathHelpers();
  testWiring();
  testTursoConfig();
  await testDegradedLightPaths();
  await testFileBootStillWorks();
  console.log('\nVercel bootstrap (Turso + cascade-safe) checks passed.');
}

main().catch((err) => {
  console.error('\nVercel bootstrap checks FAILED:', err);
  process.exit(1);
});
