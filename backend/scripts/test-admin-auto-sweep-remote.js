#!/usr/bin/env node
'use strict';

/**
 * Remote smoke: GET/POST /api/admin/tron/auto-sweep on deployed Vercel backend.
 * Run: node backend/scripts/test-admin-auto-sweep-remote.js
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
  const key = configuredAdminApiKey();
  if (!key) {
    throw new Error('ADMIN_API_KEY not set locally — cannot call production admin API');
  }
  return key;
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
            json = { raw: data?.slice?.(0, 500) };
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

function redactStatus(json) {
  if (!json || typeof json !== 'object') return json;
  const copy = { ...json };
  if (copy.env_checks) {
    copy.env_checks = copy.env_checks.map((c) => ({ id: c.id, label: c.label, ok: c.ok }));
  }
  if (copy.preflight?.master) {
    copy.preflight = {
      ...copy.preflight,
      master: { address_masked: copy.preflight.master.address_masked },
    };
  }
  return copy;
}

async function main() {
  const base = baseUrl();
  console.log(`\nAdmin auto-sweep remote smoke → ${base}\n`);

  console.log('== GET /api/admin/tron/auto-sweep?verify=1 ==');
  const status = await requestJson('GET', '/api/admin/tron/auto-sweep?verify=1&limit=50');
  console.log('HTTP', status.status);
  console.log(JSON.stringify(redactStatus(status.json), null, 2));

  console.log('\n== POST /api/admin/tron/auto-sweep (dry_run, limit=3) ==');
  const dry = await requestJson('POST', '/api/admin/tron/auto-sweep', {
    dry_run: true,
    limit: 3,
  });
  console.log('HTTP', dry.status);
  const sweep = dry.json?.sweep || {};
  console.log(JSON.stringify({
    success: dry.json?.success,
    dry_run: dry.json?.dry_run,
    message: dry.json?.message,
    checked: sweep.checked,
    swept: sweep.swept,
    skipped: sweep.skipped,
    failed: sweep.failed,
    code: dry.json?.code,
    error: dry.json?.error,
  }, null, 2));

  const statusOk = status.status === 200 && status.json?.success === true;
  const envOk = status.json?.env_ok === true;
  const dryOk = (dry.status === 200 || dry.status === 207)
    && dry.json?.dry_run === true
    && dry.json?.sweep?.dryRun === true
    && Number(dry.json?.sweep?.checked || 0) > 0;

  if (!statusOk || !envOk) {
    console.error('\nRemote auto-sweep status check FAILED (env or HTTP).');
    process.exit(1);
  }
  if (!dryOk) {
    console.error('\nRemote dry-run auto-sweep FAILED.');
    process.exit(1);
  }
  console.log('\nRemote admin auto-sweep smoke OK.');
}

main().catch((err) => {
  console.error('\nRemote auto-sweep smoke error:', err.message);
  process.exit(1);
});
