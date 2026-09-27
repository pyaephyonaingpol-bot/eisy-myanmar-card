#!/usr/bin/env node
/**
 * Unit tests for the Bitnob fixed-IP egress proxy + client wiring.
 * Does not call the real Bitnob API.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  createBitnobEgressProxyServer,
  PROXY_KEY_HEADER,
} = require('./bitnob-egress-proxy');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
    server.on('error', reject);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startMockUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        body,
      });
      if (req.url === '/api/whoami') {
        const payload = JSON.stringify({
          success: true,
          message: 'Authenticated',
          data: { auth_method: 'hmac', environment: 'sandbox', active: true },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      if (req.method === 'POST' && req.url.startsWith('/api/cards')) {
        const payload = JSON.stringify({
          success: true,
          data: { card: { id: 'card-proxy-1', status: 'pending', balance_amount: '5000000' } },
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'not found' }));
    });
  });
  const port = await listen(server);
  return {
    server,
    port,
    seen,
    origin: `http://127.0.0.1:${port}`,
  };
}

async function testRejectsMissingKey() {
  section('proxy rejects missing / wrong key');
  const upstream = await startMockUpstream();
  const proxy = createBitnobEgressProxyServer({
    secret: 'proxy-secret-test',
    upstream: new URL(upstream.origin),
  });
  const port = await listen(proxy);
  try {
    const noKey = await fetch(`http://127.0.0.1:${port}/api/whoami`);
    assert.strictEqual(noKey.status, 401);
    const wrong = await fetch(`http://127.0.0.1:${port}/api/whoami`, {
      headers: { [PROXY_KEY_HEADER]: 'nope' },
    });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(upstream.seen.length, 0);
  } finally {
    await close(proxy);
    await close(upstream.server);
  }
  console.log('ok');
}

async function testForwardsHmacAndBody() {
  section('proxy forwards HMAC headers + body to upstream');
  const upstream = await startMockUpstream();
  const proxy = createBitnobEgressProxyServer({
    secret: 'proxy-secret-test',
    upstream: new URL(upstream.origin),
  });
  const port = await listen(proxy);
  try {
    const body = JSON.stringify({
      card_type: 'virtual',
      customer_id: 'cust-1',
      amount: 5_000_000,
      currency: 'USD',
      reference: 'proxy-ref-1',
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/cards`, {
      method: 'POST',
      headers: {
        [PROXY_KEY_HEADER]: 'proxy-secret-test',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Auth-Client': 'client-abc',
        'X-Auth-Timestamp': '1700000000',
        'X-Auth-Nonce': 'abcd'.repeat(8),
        'X-Auth-Signature': 'deadbeef',
      },
      body,
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.data.card.id, 'card-proxy-1');

    assert.strictEqual(upstream.seen.length, 1);
    const hit = upstream.seen[0];
    assert.strictEqual(hit.method, 'POST');
    assert.strictEqual(hit.url, '/api/cards');
    assert.strictEqual(hit.headers['x-auth-client'], 'client-abc');
    assert.strictEqual(hit.headers['x-auth-signature'], 'deadbeef');
    assert.strictEqual(hit.headers[PROXY_KEY_HEADER], undefined);
    assert.strictEqual(hit.body, body);
  } finally {
    await close(proxy);
    await close(upstream.server);
  }
  console.log('ok');
}

async function testClientUsesEgressProxy() {
  section('lib/bitnob routes through BITNOB_EGRESS_PROXY_URL');
  const upstream = await startMockUpstream();
  const proxy = createBitnobEgressProxyServer({
    secret: 'proxy-secret-test',
    upstream: new URL(upstream.origin),
  });
  const port = await listen(proxy);

  const prev = {
    BITNOB_CLIENT_ID: process.env.BITNOB_CLIENT_ID,
    BITNOB_CLIENT_SECRET: process.env.BITNOB_CLIENT_SECRET,
    BITNOB_API_BASE_URL: process.env.BITNOB_API_BASE_URL,
    BITNOB_EGRESS_PROXY_URL: process.env.BITNOB_EGRESS_PROXY_URL,
    BITNOB_EGRESS_PROXY_SECRET: process.env.BITNOB_EGRESS_PROXY_SECRET,
  };

  process.env.BITNOB_CLIENT_ID = 'client-test-id';
  process.env.BITNOB_CLIENT_SECRET = 'client-test-secret';
  process.env.BITNOB_API_BASE_URL = 'https://api.bitnob.com'; // must NOT be hit
  process.env.BITNOB_EGRESS_PROXY_URL = `http://127.0.0.1:${port}`;
  process.env.BITNOB_EGRESS_PROXY_SECRET = 'proxy-secret-test';

  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  const bitnob = require(path.join(ROOT, 'lib/bitnob'));

  try {
    const cfg = bitnob.getBitnobConfig();
    assert.strictEqual(cfg.requestBaseUrl, `http://127.0.0.1:${port}`);
    assert.ok(cfg.egressProxyUrl);

    const who = await bitnob.validateAuth();
    assert.strictEqual(who.data.auth_method, 'hmac');
    assert.strictEqual(upstream.seen.length, 1);
    assert.strictEqual(upstream.seen[0].url, '/api/whoami');
    assert.ok(upstream.seen[0].headers['x-auth-signature']);
    assert.strictEqual(upstream.seen[0].headers[PROXY_KEY_HEADER], undefined);

    // Missing secret with proxy URL configured must fail fast.
    delete process.env.BITNOB_EGRESS_PROXY_SECRET;
    delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
    const bitnob2 = require(path.join(ROOT, 'lib/bitnob'));
    let code = null;
    try {
      await bitnob2.validateAuth();
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'BITNOB_EGRESS_PROXY_NOT_CONFIGURED');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
    await close(proxy);
    await close(upstream.server);
  }
  console.log('ok');
}

async function testBlocksNonApiPaths() {
  section('proxy blocks non-/api paths');
  const upstream = await startMockUpstream();
  const proxy = createBitnobEgressProxyServer({
    secret: 'proxy-secret-test',
    upstream: new URL(upstream.origin),
  });
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin`, {
      headers: { [PROXY_KEY_HEADER]: 'proxy-secret-test' },
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(upstream.seen.length, 0);
  } finally {
    await close(proxy);
    await close(upstream.server);
  }
  console.log('ok');
}

async function main() {
  await testRejectsMissingKey();
  await testForwardsHmacAndBody();
  await testClientUsesEgressProxy();
  await testBlocksNonApiPaths();
  console.log('\nBitnob egress proxy checks passed.');
}

main().catch((err) => {
  console.error('\nBitnob egress proxy tests FAILED');
  console.error(err);
  process.exit(1);
});
