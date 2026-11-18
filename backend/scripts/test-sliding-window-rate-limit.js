#!/usr/bin/env node
'use strict';

/**
 * Sliding-window rate limiter + sensitive-route wiring guards.
 * Run: node backend/scripts/test-sliding-window-rate-limit.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const root = path.join(__dirname, '..');
process.chdir(root);

const {
  consumeSlidingWindow,
  createSlidingWindowMiddleware,
  windowMsToUpstashDuration,
  isUpstashConfigured,
  _resetMemoryBucketsForTests,
} = require('../src/middleware/slidingWindowRateLimit');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function testMemorySlidingWindow() {
  section('Memory sliding window enforces limit');
  _resetMemoryBucketsForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const key = `test-${Date.now()}`;
  const opts = { name: 'unit', limit: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i += 1) {
    const ok = await consumeSlidingWindow(key, opts);
    assert.strictEqual(ok.success, true, `request ${i + 1} should pass`);
    assert.strictEqual(ok.backend, 'memory');
  }
  const blocked = await consumeSlidingWindow(key, opts);
  assert.strictEqual(blocked.success, false);
  assert.strictEqual(blocked.remaining, 0);
  assert.ok(blocked.reset > Date.now() - 1000);
  console.log('ok');
}

async function testWindowDurationFormat() {
  section('Upstash duration formatting');
  assert.strictEqual(windowMsToUpstashDuration(10_000), '10 s');
  assert.strictEqual(windowMsToUpstashDuration(15 * 60_000), '15 m');
  assert.strictEqual(windowMsToUpstashDuration(60 * 60_000), '1 h');
  assert.strictEqual(windowMsToUpstashDuration(24 * 60 * 60_000), '1 d');
  console.log('ok');
}

async function testExpressMiddleware429() {
  section('Express middleware returns 429 + headers');
  _resetMemoryBucketsForTests();
  const app = express();
  app.set('trust proxy', 1);
  app.use(createSlidingWindowMiddleware({
    name: 'mw-test',
    limit: 2,
    windowMs: 60_000,
    keyGenerator: () => 'mw-fixed-key',
  }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  async function hit() {
    const res = await fetch(`http://127.0.0.1:${port}/ping`);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, headers: res.headers };
  }

  const a = await hit();
  const b = await hit();
  const c = await hit();
  assert.strictEqual(a.status, 200);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(c.status, 429);
  assert.strictEqual(c.body.code, 'RATE_LIMITED');
  assert.ok(c.headers.get('x-ratelimit-limit'));
  assert.ok(c.headers.get('retry-after'));

  await new Promise((resolve) => server.close(resolve));
  console.log('ok');
}

async function testWiring() {
  section('Sensitive routes wired to sliding-window limiters');
  const security = fs.readFileSync(path.join(root, 'src/middleware/security.js'), 'utf8');
  assert.ok(security.includes('createSlidingWindowMiddleware'), 'security uses sliding window');
  assert.ok(security.includes('createCardApiRateLimiter'), 'card API limiter exported');
  assert.ok(security.includes('createPagoProxyRateLimiter'), 'pago proxy limiter exported');
  assert.ok(security.includes('createSupabaseProxyRateLimiter'), 'supabase proxy limiter exported');
  assert.ok(security.includes('CARD_API_RATE_LIMITED'), 'card API 429 code');
  assert.ok(security.includes('PAGO_PROXY_RATE_LIMITED'), 'pago proxy 429 code');

  const indexSrc = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  assert.ok(indexSrc.includes('createPagoProxyRateLimiter()'), 'pago proxy limited in index');
  assert.ok(indexSrc.includes('createSupabaseProxyRateLimiter()'), 'supabase proxy limited in index');

  const userSrc = fs.readFileSync(path.join(root, 'src/routes/user.js'), 'utf8');
  assert.ok(userSrc.includes('createCardApiRateLimiter'), 'user routes import card API limiter');
  assert.ok(userSrc.includes('cardApiLimiter'), 'user routes apply card API limiter');

  const {
    createApiRateLimiter,
    createCardApiRateLimiter,
    createPagoProxyRateLimiter,
    createSupabaseProxyRateLimiter,
  } = require('../src/middleware/security');
  assert.strictEqual(typeof createApiRateLimiter(), 'function');
  assert.strictEqual(typeof createCardApiRateLimiter(), 'function');
  assert.strictEqual(typeof createPagoProxyRateLimiter(), 'function');
  assert.strictEqual(typeof createSupabaseProxyRateLimiter(), 'function');

  // Shared Next/lib re-export resolves
  const shared = require(path.join(root, '../lib/rateLimit.js'));
  assert.strictEqual(typeof shared.consumeSlidingWindow, 'function');

  // Without Upstash env, backend reports not configured (memory path)
  assert.strictEqual(isUpstashConfigured(), false);
  console.log('ok');
}

async function main() {
  await testMemorySlidingWindow();
  await testWindowDurationFormat();
  await testExpressMiddleware429();
  await testWiring();
  console.log('\nSliding-window rate limit checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
