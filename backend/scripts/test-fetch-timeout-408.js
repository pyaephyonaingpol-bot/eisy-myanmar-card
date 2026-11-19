#!/usr/bin/env node
'use strict';

/**
 * Guards for raised client fetch timeouts + abort handling (408 after 25s fix).
 * Run: node backend/scripts/test-fetch-timeout-408.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Auth.api default timeout raised + abort helpers');
const auth = read('backend/public/auth.js');
assert.ok(auth.includes('DEFAULT_API_TIMEOUT_MS: 45000'), 'default timeout 45s');
assert.ok(auth.includes('_resolveTimeoutMs'), 'timeout resolver');
assert.ok(auth.includes('_normalizeFetchError'), 'normalized abort/timeout errors');
assert.ok(auth.includes("code = 'REQUEST_ABORTED'"), 'caller abort distinct from timeout');
assert.ok(auth.includes('opts.signal'), 'external AbortSignal supported');
assert.ok(auth.includes('run.catch(() => {})'), 'soft-handle avoids unhandledrejection');
assert.ok(auth.includes('suppressErrorReport'), 'Auth.api can suppress error reports');
assert.ok(/async apiForm[\s\S]*AbortController/.test(auth), 'apiForm uses AbortController');
assert.ok(!/:\s*25000\s*;/.test(auth.split('DEFAULT_API_TIMEOUT_MS')[0]), 'old 25s default removed from timeout path');
console.log('ok');

section('Dashboard wallet prefers fast path + longer full timeout');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('useFast'), 'fast path helper');
assert.ok(dash.includes('useFast ? 20000 : 45000') || dash.includes('20000 : 45000'), 'raised wallet timeouts');
assert.ok(dash.includes("pending.catch((err) =>"), 'inflight soft-catch');
assert.ok(dash.includes("err?.code === 'REQUEST_ABORTED'"), 'aborts are not retried forever');
assert.ok(dash.includes('timeoutMs: 45000'), 'usdt overview timeout raised in dashboard');
console.log('ok');

section('USDT wallet API timeouts');
const usdt = read('backend/public/src/services/usdtWalletApi.js');
assert.ok(usdt.includes('timeoutMs: 45000'), 'overview/linked 45s');
assert.ok(usdt.includes("params.set('fast', '1')"), 'platform wallet defaults to fast');
assert.ok(usdt.includes('timeoutMs: 25000'), 'balance timeout raised');
console.log('ok');

section('Server wallet HD budget tightened');
const user = read('backend/src/routes/user.js');
assert.ok(user.includes("'2500'"), 'HD scan budget default 2.5s');
assert.ok(user.includes('captureError'), 'wallet errors monitored');
console.log('ok');

section('Cache bust');
const html = read('backend/public/index.html');
assert.ok(html.includes('fetchTimeout45s') || html.includes('auth.js?v='), 'auth cache bust');
assert.ok(html.includes('usdtWalletApi.js?v='), 'usdt api cache bust');
console.log('ok');

section('Auth timeout resolver smoke (vm)');
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(auth, sandbox);
assert.ok(sandbox.Auth, 'Auth attached to window');
assert.strictEqual(sandbox.Auth.DEFAULT_API_TIMEOUT_MS, 45000);
assert.strictEqual(sandbox.Auth._resolveTimeoutMs({}), 45000);
assert.strictEqual(sandbox.Auth._resolveTimeoutMs({ timeoutMs: 12000 }), 12000);
const timeoutErr = sandbox.Auth._normalizeFetchError(new Error('aborted'), {
  method: 'GET',
  path: '/api/x',
  timeoutMs: 45000,
  timedOut: true,
  abortedByCaller: false,
});
assert.strictEqual(timeoutErr.code, 'REQUEST_TIMEOUT');
assert.strictEqual(timeoutErr.status, 408);
assert.ok(/45s/.test(timeoutErr.message));
console.log('ok');

console.log('\nFetch timeout 408 checks passed.');
