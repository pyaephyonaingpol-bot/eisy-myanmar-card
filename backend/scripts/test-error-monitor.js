#!/usr/bin/env node
'use strict';

/**
 * Error monitor + Sentry wiring guards.
 * Run: node backend/scripts/test-error-monitor.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.join(__dirname, '..');
process.chdir(root);

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function testCaptureWithoutSentry() {
  section('captureError works without SENTRY_DSN');
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  delete process.env.SENTRY_DSN_PUBLIC;
  delete require.cache[require.resolve('../src/services/errorMonitor')];
  const monitor = require('../src/services/errorMonitor');
  monitor._resetForTests();

  const err = new Error('unit boom');
  err.code = 'UNIT_TEST';
  err.status = 500;
  const result = monitor.captureError(err, {
    source: 'test',
    path: '/api/unit',
    severity: 'high',
  });
  assert.strictEqual(result.captured, true);
  assert.ok(result.fingerprint);
  assert.strictEqual(monitor.isEnabled(), false);

  const pub = monitor.getPublicClientConfig();
  assert.strictEqual(pub.enabled, false);
  assert.strictEqual(pub.dsn, null);
  console.log('ok');
}

async function testPublicConfigWithDsn() {
  section('public client config exposes dedicated browser DSN');
  delete require.cache[require.resolve('../src/services/errorMonitor')];
  const monitor = require('../src/services/errorMonitor');
  monitor._resetForTests();
  process.env.SENTRY_DSN_PUBLIC = 'https://public@o0.ingest.sentry.io/1';
  process.env.SENTRY_DSN = 'https://server@o0.ingest.sentry.io/2';
  const pub = monitor.getPublicClientConfig();
  assert.strictEqual(pub.enabled, true);
  assert.strictEqual(pub.dsn, 'https://public@o0.ingest.sentry.io/1');
  delete process.env.SENTRY_DSN_PUBLIC;
  delete process.env.SENTRY_DSN;
  console.log('ok');
}

async function testExpressErrorHandler() {
  section('Express error handler returns 500 JSON');
  delete require.cache[require.resolve('../src/services/errorMonitor')];
  const monitor = require('../src/services/errorMonitor');
  monitor._resetForTests();

  const app = express();
  app.get('/boom', () => {
    const err = new Error('route failed');
    err.status = 500;
    throw err;
  });
  // Express 4 doesn't catch throw in sync without wrap — use next(err)
  app.get('/fail', (req, res, next) => {
    const err = new Error('handled fail');
    err.code = 'TEST_FAIL';
    err.status = 503;
    next(err);
  });
  app.use(monitor.createExpressErrorHandler());

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/fail`);
  const body = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(body.code, 'TEST_FAIL');
  await new Promise((resolve) => server.close(resolve));
  console.log('ok');
}

async function testClientErrorsRoute() {
  section('POST /api/client-errors accepts payload');
  delete require.cache[require.resolve('../src/services/errorMonitor')];
  delete require.cache[require.resolve('../src/routes/clientErrors')];
  const monitor = require('../src/services/errorMonitor');
  monitor._resetForTests();

  const app = express();
  app.use(express.json());
  app.use('/api/client-errors', require('../src/routes/clientErrors'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Request timed out after 10s',
      code: 'REQUEST_TIMEOUT',
      status: 408,
      path: '/api/user/cards',
      method: 'GET',
      source: 'auth.api',
    }),
  });
  assert.strictEqual(res.status, 204);

  const bad = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.strictEqual(bad.status, 400);

  await new Promise((resolve) => server.close(resolve));
  console.log('ok');
}

async function testWiring() {
  section('Files wired for client + server monitoring');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const instant = fs.readFileSync(path.join(root, 'public/instant.html'), 'utf8');
  for (const [name, doc] of [['index', html], ['instant', instant]]) {
    assert.ok(doc.includes('errorMonitor.js'), `${name} loads errorMonitor.js`);
    const em = doc.indexOf('errorMonitor.js');
    const auth = doc.indexOf('auth.js');
    assert.ok(em > -1 && auth > em, `${name}: errorMonitor before auth`);
  }

  const client = fs.readFileSync(path.join(root, 'public/errorMonitor.js'), 'utf8');
  assert.ok(client.includes('REQUEST_TIMEOUT'));
  assert.ok(client.includes('/api/client-errors'));
  assert.ok(client.includes('browser.sentry-cdn.com'));

  const indexSrc = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  assert.ok(indexSrc.includes('initErrorMonitor'));
  assert.ok(indexSrc.includes('installProcessHandlers'));
  assert.ok(indexSrc.includes('createExpressErrorHandler'));
  assert.ok(indexSrc.includes('createSlowRequestMonitor'));
  assert.ok(indexSrc.includes("'/api/client-errors'"));

  const configSrc = fs.readFileSync(path.join(root, 'src/routes/config.js'), 'utf8');
  assert.ok(configSrc.includes("'/monitoring'"));

  const shared = require(path.join(root, '../lib/errorMonitor.js'));
  assert.strictEqual(typeof shared.captureError, 'function');
  console.log('ok');
}

async function main() {
  await testCaptureWithoutSentry();
  await testPublicConfigWithDsn();
  await testExpressErrorHandler();
  await testClientErrorsRoute();
  await testWiring();
  console.log('\nError monitor checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
