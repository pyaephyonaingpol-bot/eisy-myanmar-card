#!/usr/bin/env node
/**
 * Guards for requireAuth transient 503 + client soft-handling of
 * "Authentication error" unhandledrejection (fingerprint 3a843889193aaf6b).
 *
 * Run: node backend/scripts/test-auth-unhandled-500.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.join(__dirname, '..');
process.chdir(root);

function section(title) {
  console.log(`\n== ${title} ==`);
}

function fingerprintFor(code, status, pathStr, msg) {
  return crypto
    .createHash('sha1')
    .update(`${code || ''}|${status || ''}|${pathStr || ''}|${msg}`)
    .digest('hex')
    .slice(0, 16);
}

section('Known noisy fingerprint matches Authentication error unhandledrejection');
assert.strictEqual(
  fingerprintFor('UNHANDLED_REJECTION', 500, '', 'Authentication error'),
  '3a843889193aaf6b'
);
console.log('ok');

section('requireAuth source maps transient failures to coded 503');
{
  const authSrc = fs.readFileSync(path.join(root, 'src/middleware/auth.js'), 'utf8');
  assert.ok(authSrc.includes('AUTH_UNAVAILABLE'), 'user auth transient code');
  assert.ok(authSrc.includes('AUTH_DB_NOT_READY'), 'user auth db-not-ready code');
  assert.ok(authSrc.includes('AUTH_ERROR'), 'unexpected auth failures still coded');
  assert.ok(authSrc.includes('findSessionByTokenWithRetry'), 'session lookup retries');
  assert.ok(authSrc.includes('authFailureResponse'), 'shared auth failure mapper');
  console.log('ok');
}

async function testRequireAuthTransient() {
  section('requireAuth maps transient Turso failures to 503 AUTH_UNAVAILABLE');
  process.env.NODE_ENV = 'test';
  const UserSession = require('../src/models/UserSession');
  const { requireAuth } = require('../src/middleware/auth');
  const original = UserSession.findByToken;
  let calls = 0;
  UserSession.findByToken = async () => {
    calls += 1;
    throw new Error('fetch failed: timeout connecting to Turso');
  };
  try {
    const req = { headers: { authorization: 'Bearer fake-user-token' } };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.code, 'AUTH_UNAVAILABLE');
    assert.ok(calls >= 2, 'retries once on transient Turso failure');
    console.log('ok', res.body);
  } finally {
    UserSession.findByToken = original;
  }
}

section('Client soft-handles Authentication error + AUTH_UNAVAILABLE');
{
  const mon = fs.readFileSync(path.join(root, 'public/errorMonitor.js'), 'utf8');
  assert.ok(mon.includes('isSoftAuthFailure'), 'soft auth classifier');
  assert.ok(mon.includes('Authentication error'), 'legacy message filtered');
  assert.ok(mon.includes('AUTH_UNAVAILABLE'), 'AUTH_UNAVAILABLE filtered');
  const auth = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
  assert.ok(auth.includes('err.path = path'), 'Auth.api attaches path');
  assert.ok(auth.includes('softAuthFailure'), 'Auth.api marks soft auth failures');
  assert.ok(auth.includes('AUTH_UNAVAILABLE'), 'Auth.api suppresses AUTH_UNAVAILABLE reports');
  console.log('ok');
}

async function testClientErrorsSkipsAuthNoise() {
  section('POST /api/client-errors skips Authentication error unhandledrejection');
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

  const legacy = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Authentication error',
      code: 'UNHANDLED_REJECTION',
      status: 500,
      path: null,
      source: 'unhandledrejection',
    }),
  });
  assert.strictEqual(legacy.status, 204);

  const unavailable = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Authentication temporarily unavailable — retry',
      code: 'AUTH_UNAVAILABLE',
      status: 503,
      path: '/api/user/cards/12/3ds',
      method: 'GET',
      source: 'auth.api',
    }),
  });
  assert.strictEqual(unavailable.status, 204);

  const other = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Card issue failed hard',
      code: 'CARD_ISSUE_FAILED',
      status: 500,
      path: '/api/user/cards/request',
      source: 'auth.api',
    }),
  });
  assert.strictEqual(other.status, 204);

  await new Promise((resolve) => server.close(resolve));
  console.log('ok');
}

section('Cache bust for auth + error monitor scripts');
{
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(html.includes('authSoft500'), 'index.html cache-busts auth/errorMonitor');
  const instant = fs.readFileSync(path.join(root, 'public/instant.html'), 'utf8');
  assert.ok(instant.includes('authSoft500'), 'instant.html cache-busts auth/errorMonitor');
  console.log('ok');
}

(async () => {
  await testRequireAuthTransient();
  await testClientErrorsSkipsAuthNoise();
  console.log('\nAuth unhandled 500 soft-handling checks passed.');
})().catch((err) => {
  console.error('\nAuth unhandled 500 checks FAILED:', err);
  process.exit(1);
});
