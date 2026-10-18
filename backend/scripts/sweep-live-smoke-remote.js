#!/usr/bin/env node
'use strict';

/**
 * Remote smoke against deployed backend (uses Vercel env + Turso on server).
 * Run: node scripts/sweep-live-smoke-remote.js
 * Optional: SWEEP_SMOKE_BASE_URL=https://eisymyanmar.com
 */
const https = require('https');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv').loadEnv({ force: true });

const { firstEnv } = require('../src/lib/envAliases');

function baseUrl() {
  return (
    firstEnv('SWEEP_SMOKE_BASE_URL', 'PUBLIC_BASE_URL')
    || 'https://eisymyanmar.com'
  ).replace(/\/$/, '');
}

function adminKey() {
  const { configuredAdminApiKey } = require('../src/middleware/auth');
  return configuredAdminApiKey();
}

function requestJson(method, urlPath, body = null) {
  const key = adminKey();
  const url = new URL(urlPath, `${baseUrl()}/`);
  const payload = body != null ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
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
  console.log(`\nRemote sweep smoke → ${baseUrl()}`);

  console.log('\n== GET /api/admin/sweep-preflight?verify=1 ==');
  const preflight = await requestJson('GET', '/api/admin/sweep-preflight?verify=1');
  console.log('HTTP', preflight.status);
  console.log(JSON.stringify(preflight.json, null, 2));

  console.log('\n== POST /api/admin/sweep-deposits (dry_run) ==');
  const sweep = await requestJson('POST', '/api/admin/sweep-deposits', { dry_run: true, limit: 50 });
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
    console.error('\nRemote sweep smoke FAILED.');
    process.exitCode = 1;
  } else {
    console.log('\nRemote sweep smoke OK.');
  }
}

main().catch((err) => {
  console.error('\nRemote sweep smoke error:', err);
  process.exit(1);
});
