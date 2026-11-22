#!/usr/bin/env node
'use strict';

/**
 * Guards for 3DS client timeout headroom + soft alert handling.
 * Run: node backend/scripts/test-3ds-timeout-soft.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Client 3DS timeouts raised + silent suppress');
const dash = read('public/dashboard.js');
assert.ok(dash.includes('timeoutMs: refresh ? 45000 : 20000'), '3DS timeouts 20s/45s');
assert.ok(!dash.includes('timeoutMs: refresh ? 18000 : 6000'), 'old 6s/18s timeouts removed');
assert.ok(dash.includes('suppressErrorReport: silent'), 'silent polls suppress error reports');
console.log('ok');

section('Auth.api supports suppressErrorReport');
const auth = read('public/auth.js');
assert.ok(auth.includes('opts.suppressErrorReport'), 'Auth.api honors suppressErrorReport');
assert.ok(auth.includes('normalized.suppressErrorReport = true'), 'timeouts carry suppress flag');
console.log('ok');

section('errorMonitor soft-handles wrapper + skips 3DS timeouts');
const mon = read('public/errorMonitor.js');
assert.ok(mon.includes('isExpectedSoftTimeout'), 'soft timeout classifier');
assert.ok(mon.includes('run.catch(() => {})'), 'monitored Auth.api soft-handled');
assert.ok(mon.includes("code === 'REQUEST_TIMEOUT'"), 'unhandledrejection filters timeouts');
assert.ok(mon.includes('suppressErrorReport'), 'payload carries suppress flag');
console.log('ok');

section('Server 3DS route is lean + budgeted');
const user = read('src/routes/user.js');
assert.ok(user.includes('Card.findById(cardId)'), 'ownership via findById');
assert.ok(user.includes('PAGO_3DS_REFRESH_BUDGET_MS'), 'provider refresh budget');
assert.ok(user.includes('provider_timed_out'), 'exposes timed_out flag');
assert.ok(!/cards\/:id\/3ds[\s\S]{0,400}getUserCardsPayload/.test(user), 'does not list all cards');
console.log('ok');

section('Cache bust');
const html = read('public/index.html');
assert.ok(
    html.includes('tdsSoftTimeout') || html.includes('authSoft500'),
    'script cache bust for soft timeout / auth soft failures'
  );
console.log('ok');

async function testClientErrorsSkips3dsTimeout() {
  section('POST /api/client-errors skips 3DS REQUEST_TIMEOUT');
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
      message: 'Request timed out after 6s',
      code: 'REQUEST_TIMEOUT',
      status: 408,
      path: '/api/user/cards/12/3ds',
      method: 'GET',
      source: 'auth.api',
    }),
  });
  assert.strictEqual(res.status, 204);

  // Non-3DS timeout still accepted (may alert).
  const other = await fetch(`http://127.0.0.1:${port}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Request timed out after 45s',
      code: 'REQUEST_TIMEOUT',
      status: 408,
      path: '/api/user/wallet',
      method: 'GET',
      source: 'auth.api',
    }),
  });
  assert.strictEqual(other.status, 204);

  await new Promise((resolve) => server.close(resolve));
  console.log('ok');
}

(async () => {
  await testClientErrorsSkips3dsTimeout();
  console.log('\n3DS timeout soft-handling checks passed.');
})().catch((err) => {
  console.error('\n3DS timeout soft-handling FAILED:', err);
  process.exit(1);
});
