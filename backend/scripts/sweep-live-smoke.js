#!/usr/bin/env node
'use strict';

/**
 * HTTP smoke: GET /api/admin/sweep-preflight?verify=1 and POST dry-run sweep.
 * Run: node scripts/sweep-live-smoke.js
 */
const http = require('http');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv').loadEnv({ force: true });

function adminKey() {
  const { configuredAdminApiKey } = require('../src/middleware/auth');
  return configuredAdminApiKey();
}

function requestJson(port, method, urlPath, body = null) {
  const key = adminKey();
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': key,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const { app } = require('../src/index.js');

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  try {
    console.log('\n== GET /api/admin/sweep-preflight?verify=1 ==');
    const preflight = await requestJson(port, 'GET', '/api/admin/sweep-preflight?verify=1');
    console.log('HTTP', preflight.status);
    console.log(JSON.stringify(preflight.json, null, 2));

    console.log('\n== POST /api/admin/sweep-deposits (dry_run) ==');
    const sweep = await requestJson(port, 'POST', '/api/admin/sweep-deposits', {
      dry_run: true,
      limit: 50,
    });
    console.log('HTTP', sweep.status);
    console.log(JSON.stringify(sweep.json, null, 2));

    const ok =
      preflight.status === 200
      && preflight.json?.success === true
      && preflight.json?.preflight?.ready === true
      && sweep.status === 200
      && sweep.json?.success === true
      && sweep.json?.sweep?.dryRun === true;

    if (!ok) {
      console.error('\nSweep live smoke FAILED — see responses above.');
      process.exitCode = 1;
    } else {
      console.log('\nSweep live smoke OK (preflight ready + dry-run sweep succeeded).');
    }
  } finally {
    await new Promise((r) => server.close(r));
    await closeDb?.().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nSweep live smoke error:', err);
  process.exit(1);
});
