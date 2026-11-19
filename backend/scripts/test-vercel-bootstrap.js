#!/usr/bin/env node
/**
 * Vercel serverless bootstrap — no Turso dependency.
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

  const diag = safeBootstrapDiagnostics(new Error('boot boom'));
  assert.strictEqual(diag.error_message, 'boot boom');
  assert.strictEqual(diag.turso, false);
  console.log('ok');
}

function testWiring() {
  section('Entry + client cascade guards wired (no Turso)');
  const apiSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiSrc.includes('BOOTSTRAP_FAILED'));
  assert.ok(apiSrc.includes('isBootstrapLightPath'));
  assert.ok(apiSrc.includes('turso: false'));
  assert.ok(!/BACKEND_URL|NEXT_PUBLIC_API_URL/.test(apiSrc), 'not an HTTP proxy to Droplet');

  const clientSrc = fs.readFileSync(path.join(__dirname, '../public/errorMonitor.js'), 'utf8');
  assert.ok(clientSrc.includes('shouldSkipServerIngest'));
  assert.ok(clientSrc.includes('BOOTSTRAP_FAILED'));

  const ingestSrc = fs.readFileSync(path.join(__dirname, '../src/routes/clientErrors.js'), 'utf8');
  assert.ok(ingestSrc.includes('skipped cascade ingest'));

  const dbCfg = fs.readFileSync(path.join(__dirname, '../src/lib/databaseConfig.js'), 'utf8');
  assert.ok(dbCfg.includes('Turso / remote LibSQL'));
  assert.ok(!dbCfg.includes('DATABASE_AUTH_TOKEN_MISSING'));
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

function testTursoIgnored() {
  section('Remote Turso DATABASE_URL is ignored');
  const prev = {
    DATABASE_URL: process.env.DATABASE_URL,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = 'libsql://missing-db-example.turso.io';
  process.env.TURSO_DATABASE_URL = 'libsql://also-ignored.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'should-not-matter';
  process.env.DATABASE_AUTH_TOKEN = 'should-not-matter';

  clearDbRelatedCache();
  const { getDatabaseConfig, getDatabaseInfo, isTursoLikeUrl } = require('../src/lib/databaseConfig');
  assert.strictEqual(isTursoLikeUrl('libsql://x.turso.io'), true);
  const cfg = getDatabaseConfig();
  assert.strictEqual(cfg.mode, 'libsql');
  assert.ok(String(cfg.url).startsWith('file:'));
  assert.strictEqual(cfg.authToken, undefined);
  assert.ok(/Turso|ignored/i.test(String(cfg.warning || '')));
  const info = getDatabaseInfo();
  assert.strictEqual(info.turso, false);

  // Explicit local file URL must win even when leftover TURSO_* vars remain.
  const localFile = path.join(os.tmpdir(), `eisy-keep-file-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${localFile}`;
  clearDbRelatedCache();
  const { getDatabaseConfig: getCfg2 } = require('../src/lib/databaseConfig');
  const cfg2 = getCfg2();
  assert.strictEqual(cfg2.filePath, localFile);
  assert.strictEqual(cfg2.persistent, true);
  assert.ok(/Turso|ignored/i.test(String(cfg2.warning || '')));

  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearDbRelatedCache();
  console.log('ok');
}

async function testBootWithoutTurso() {
  section('Vercel handler boots with Turso env present (ignored)');
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

  const tmpDb = path.join(os.tmpdir(), `eisy-no-turso-${Date.now()}.db`);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'preview';
  process.env.DATABASE_URL = `file:${tmpDb}`;
  process.env.TURSO_DATABASE_URL = 'libsql://should-be-ignored.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'ignored';
  process.env.DATABASE_AUTH_TOKEN = 'ignored';
  delete process.env.LIBSQL_URL;
  delete process.env.LIBSQL_AUTH_TOKEN;

  clearDbRelatedCache();
  // Force a clean db module for this file path
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

  // Boots successfully without Turso — auth required, not BOOTSTRAP_FAILED.
  const wallet = await fetch(`http://127.0.0.1:${port}/api/tron/wallet/address`);
  assert.notStrictEqual(wallet.status, 503);
  const walletText = await wallet.text();
  assert.ok(!/BOOTSTRAP_FAILED/.test(walletText));

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
  testTursoIgnored();
  await testBootWithoutTurso();
  console.log('\nVercel bootstrap (no Turso) checks passed.');
}

main().catch((err) => {
  console.error('\nVercel bootstrap checks FAILED:', err);
  process.exit(1);
});
