#!/usr/bin/env node
/**
 * Compatibility check: Helmet + rate-limit must not break
 * frontend SPA connections or Kripicard outbound API usage.
 *
 * Run: node backend/scripts/test-security-frontend-kripicard-compat.js
 */
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function request(port, {
  method = 'GET',
  url = '/',
  headers = {},
  body = null,
} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: url,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'compat-test-auth-secret';
  process.env.SENSITIVE_DATA_ENCRYPTION_KEY = process.env.SENSITIVE_DATA_ENCRYPTION_KEY
    || crypto.randomBytes(32).toString('hex');
  // Tight but not zero — used only to confirm limiter is present, not to trip normal flows
  process.env.RATE_LIMIT_API_MAX = process.env.RATE_LIMIT_API_MAX || '500';
  process.env.PORT = '0'; // unused — we bind ourselves

  const { app } = require('../src/index');
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  console.log(`listening on ${port}`);

  try {
    section('Frontend shell + static assets (Helmet must not CSP-block)');
    const home = await request(port, { url: '/' });
    assert.strictEqual(home.status, 200, 'index.html must load');
    assert.ok(!home.headers['content-security-policy'], 'CSP must stay disabled for SPA inline scripts');
    assert.strictEqual(home.headers['x-frame-options'], 'DENY');
    assert.strictEqual(home.headers['x-content-type-options'], 'nosniff');
    // CORP cross-origin keeps API/assets usable from allowed frontends
    assert.ok(
      /cross-origin/i.test(home.headers['cross-origin-resource-policy'] || ''),
      'CORP should be cross-origin'
    );

    const css = await request(port, { url: '/styles.css' });
    assert.strictEqual(css.status, 200, 'styles.css must load');

    const dash = await request(port, { url: '/dashboard.js' });
    assert.strictEqual(dash.status, 200, 'dashboard.js must load');

    const cardsApi = await request(port, { url: '/src/services/cardsApi.js' });
    assert.strictEqual(cardsApi.status, 200, 'cardsApi.js must load');
    console.log('ok');

    section('CORS preflight (frontend → API) not blocked by rate limiter');
    const origin = 'https://eisymyanmar.com';
    const preflight = await request(port, {
      method: 'OPTIONS',
      url: '/api/user/card/pricing',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type,x-pin-token',
      },
    });
    assert.ok(preflight.status === 204 || preflight.status === 200, `preflight status ${preflight.status}`);
    assert.ok(
      preflight.status !== 429,
      'OPTIONS preflight must never be rate-limited'
    );
    assert.ok(
      preflight.headers['access-control-allow-origin'] === origin
      || preflight.headers['access-control-allow-origin'] === '*',
      `CORS ACAO missing: ${preflight.headers['access-control-allow-origin']}`
    );
    console.log('ok');

    section('Same-origin API health + config (frontend bootstrap)');
    const health = await request(port, {
      url: '/health',
      headers: { Origin: origin },
    });
    assert.strictEqual(health.status, 200);
    const healthJson = JSON.parse(health.body);
    assert.strictEqual(healthJson.status, 'ok');
    assert.ok(healthJson.security, 'security status present');

    const cfg = await request(port, {
      url: '/api/config/supabase',
      headers: { Origin: origin },
    });
    // 200 with config or 503/200 empty — must not be 429 / CORS failure
    assert.notStrictEqual(cfg.status, 429, 'config must not be rate-limited on first hit');
    assert.ok(cfg.status < 500 || cfg.status === 503, `unexpected config status ${cfg.status}`);
    if (cfg.headers['access-control-allow-origin']) {
      assert.ok(
        cfg.headers['access-control-allow-origin'] === origin
        || cfg.headers['access-control-allow-origin'] === '*'
      );
    }
    console.log('ok — /api/config/supabase status', cfg.status);

    section('Kripicard outbound path unaffected by Helmet/rate-limit');
    // Outbound provider calls use global fetch from Node — not Express middleware.
    // Stub fetch and exercise the same helper the card pricing route uses.
    const originalFetch = global.fetch;
    let outboundUrl = null;
    global.fetch = async (url, opts = {}) => {
      outboundUrl = String(url);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: [
              { bin: '441357', status: 'active', card_type: 'VISA', country: 'US' },
            ],
          });
        },
      };
    };

    process.env.KRIPICARD_API_KEY = process.env.KRIPICARD_API_KEY || 'compat-test-key';
    delete process.env.KRIPICARD_ALLOWED_BINS;
    delete process.env.KRIPICARD_DEFAULT_BIN;
    delete require.cache[require.resolve('../../lib/kripicard')];
    delete require.cache[require.resolve('../src/services/cardWalletService')];
    const { fetchAvailableBins } = require('../../lib/kripicard');
    const {
      getKripicardBinOptions,
      resetKripicardBinCacheForTests,
    } = require('../src/services/cardWalletService');
    resetKripicardBinCacheForTests();

    const live = await fetchAvailableBins();
    assert.ok(outboundUrl && /kripicard\.com|bins/i.test(outboundUrl), `outbound URL: ${outboundUrl}`);
    assert.ok(Array.isArray(live.bins) && live.bins.includes('441357'), 'live bins parsed');

    const options = await getKripicardBinOptions({ forceRefresh: true });
    assert.ok(options.bins.length >= 1, 'bin options available for Apply Card UI');
    assert.ok(
      options.source === 'kripicard_api'
      || options.source === 'kripicard_api+env'
      || options.source === 'builtin_fallback',
      `unexpected bins source ${options.source}`
    );

    // Pricing route still requires auth — unauthenticated must be 401, not 429 / 5xx from helmet
    const pricing = await request(port, {
      url: '/api/user/card/pricing',
      headers: { Origin: origin, Accept: 'application/json' },
    });
    assert.strictEqual(pricing.status, 401, `pricing without auth should be 401, got ${pricing.status}`);
    assert.notStrictEqual(pricing.status, 429);
    global.fetch = originalFetch;
    console.log('ok — outbound Kripicard fetch works; pricing gate intact');

    section('Rate-limit headers present on API without breaking JSON');
    const limited = await request(port, {
      url: '/api/config/supabase',
      headers: { Origin: origin },
    });
    // RateLimit headers (draft standard) from express-rate-limit v8
    const hasRl = Boolean(
      limited.headers['ratelimit-limit']
      || limited.headers['rate-limit-limit']
      || limited.headers['x-ratelimit-limit']
    );
    assert.ok(hasRl, 'RateLimit-* headers should be set on /api responses');
    assert.notStrictEqual(limited.status, 429);
    console.log('ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\nSecurity ↔ Frontend/Kripicard compatibility checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
