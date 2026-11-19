#!/usr/bin/env node
/**
 * Vercel serverless bootstrap + cascade-guard checks.
 * Run: node backend/scripts/test-vercel-bootstrap.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testLightPathHelpers() {
  section('isBootstrapLightPath');
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

  const diag = safeBootstrapDiagnostics(new Error('Turso boom'));
  assert.strictEqual(diag.error_message, 'Turso boom');
  assert.ok('has_database_url' in diag);
  assert.ok('has_database_auth_token' in diag);
  console.log('ok');
}

function testWiring() {
  section('Entry + client cascade guards wired');
  const apiSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiSrc.includes('BOOTSTRAP_FAILED'));
  assert.ok(apiSrc.includes('isBootstrapLightPath'));
  assert.ok(apiSrc.includes('handleLightRequest'));
  assert.ok(apiSrc.includes('has_database_url'));
  assert.ok(!/BACKEND_URL|NEXT_PUBLIC_API_URL/.test(apiSrc), 'not an HTTP proxy to Droplet');

  const clientSrc = fs.readFileSync(path.join(__dirname, '../public/errorMonitor.js'), 'utf8');
  assert.ok(clientSrc.includes('shouldSkipServerIngest'));
  assert.ok(clientSrc.includes('BOOTSTRAP_FAILED'));
  assert.ok(clientSrc.includes('/api/client-errors'));

  const ingestSrc = fs.readFileSync(path.join(__dirname, '../src/routes/clientErrors.js'), 'utf8');
  assert.ok(ingestSrc.includes('skipped cascade ingest'));

  const dbCfg = fs.readFileSync(path.join(__dirname, '../src/lib/databaseConfig.js'), 'utf8');
  assert.ok(dbCfg.includes('DATABASE_AUTH_TOKEN_MISSING'));
  console.log('ok');
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

async function testDegradedLightHandlers() {
  section('Degraded light handlers answer without initDb');
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    LIBSQL_URL: process.env.LIBSQL_URL,
    LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = 'libsql://missing-db-example.turso.io';
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.LIBSQL_AUTH_TOKEN;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.LIBSQL_URL;

  clearDbRelatedCache();

  const { getDatabaseConfig } = require('../src/lib/databaseConfig');
  assert.throws(
    () => getDatabaseConfig(),
    (err) => err.code === 'DATABASE_AUTH_TOKEN_MISSING'
  );

  clearDbRelatedCache();
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
  assert.strictEqual(mon.status, 200, 'monitoring should degrade to 200 without DB');
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
  assert.strictEqual(ingest.status, 204, 'client-errors should ack during degraded bootstrap');

  const wallet = await fetch(`http://127.0.0.1:${port}/api/tron/wallet/address`);
  assert.strictEqual(wallet.status, 503);
  const walletBody = await wallet.json();
  assert.strictEqual(walletBody.code, 'BOOTSTRAP_FAILED');
  assert.strictEqual(walletBody.diagnostics.has_database_url, true);
  assert.strictEqual(walletBody.diagnostics.has_database_auth_token, false);

  await new Promise((resolve) => server.close(resolve));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearDbRelatedCache();
  console.log('ok');
}

async function main() {
  testLightPathHelpers();
  testWiring();
  await testDegradedLightHandlers();
  console.log('\nVercel bootstrap checks passed.');
}

main().catch((err) => {
  console.error('\nVercel bootstrap checks FAILED:', err);
  process.exit(1);
});
