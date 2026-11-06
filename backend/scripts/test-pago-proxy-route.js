'use strict';

/**
 * Smoke: path rewriting for Droplet /api/pago proxy + requests reach upstream with correct path.
 */
const http = require('http');
const assert = require('assert');

async function testProxyForwardsPath() {
  let lastUpstreamPath = '';
  const upstream = http.createServer((req, res) => {
    lastUpstreamPath = req.url.split('?')[0];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: lastUpstreamPath }));
  });

  await new Promise((resolve, reject) => {
    upstream.listen(0, '127.0.0.1', resolve);
    upstream.on('error', reject);
  });
  const upPort = upstream.address().port;
  const prevOrigin = process.env.PAGO_PROXY_UPSTREAM_ORIGIN;
  process.env.PAGO_PROXY_UPSTREAM_ORIGIN = `http://127.0.0.1:${upPort}`;

  // eslint-disable-next-line global-require
  delete require.cache[require.resolve('../src/routes/pagocardsProxy')];
  // eslint-disable-next-line global-require
  delete require.cache[require.resolve('../src/index.js')];
  // eslint-disable-next-line global-require
  const { app } = require('../src/index.js');

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const appPort = server.address().port;

  try {
    const url = `http://127.0.0.1:${appPort}/api/pago/cards/test-id`;
    const res = await fetch(url, { method: 'GET', headers: { publickey: 'k', secretkey: 's' } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.path, '/api/v1/cards/test-id');
    assert.strictEqual(lastUpstreamPath, '/api/v1/cards/test-id');
    console.log('proxy forwards to upstream: ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    if (prevOrigin === undefined) delete process.env.PAGO_PROXY_UPSTREAM_ORIGIN;
    else process.env.PAGO_PROXY_UPSTREAM_ORIGIN = prevOrigin;
  }
}

(async () => {
  await testProxyForwardsPath();
  console.log('test-pago-proxy-route: all passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
