#!/usr/bin/env node
'use strict';

/**
 * Ensure ADMIN_EMAIL / ADMIN_PASSWORD map to a super_admin in the active DB.
 *
 * Local (uses DATABASE_URL from env / file DB):
 *   node scripts/ensure-env-admin.js
 *
 * Against a running deployment (after this code is deployed):
 *   ADMIN_API_KEY=... node scripts/ensure-env-admin.js --remote https://www.eisymyanmar.com
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

async function ensureLocal() {
  const { initDb, closeDb } = require('../src/db');
  const {
    ensureEnvSuperAdmin,
    getEnvAdminMappingStatus,
  } = require('../src/services/adminAuthService');
  const { getDatabaseInfo } = require('../src/lib/databaseConfig');

  await initDb();
  console.log('[ensure-env-admin] db=', getDatabaseInfo());
  const result = await ensureEnvSuperAdmin({ source: 'cli' });
  console.log('[ensure-env-admin] result=', JSON.stringify(result, null, 2));
  console.log('[ensure-env-admin] mapping=', await getEnvAdminMappingStatus());
  await closeDb().catch(() => {});
  if (!result.ok && result.skipped) process.exitCode = 2;
}

async function ensureRemote(baseUrl) {
  const key = String(process.env.ADMIN_API_KEY || '').trim();
  if (!key) throw new Error('ADMIN_API_KEY required for --remote');
  const url = `${String(baseUrl).replace(/\/$/, '')}/api/admin/auth/ensure-env-admin`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key,
    },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  console.log('[ensure-env-admin] remote status=', res.status);
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exitCode = 1;
}

(async () => {
  const remoteIdx = process.argv.indexOf('--remote');
  if (remoteIdx >= 0) {
    const base = process.argv[remoteIdx + 1]
      || process.env.PUBLIC_BASE_URL
      || 'https://www.eisymyanmar.com';
    await ensureRemote(base);
  } else {
    await ensureLocal();
  }
})().catch((err) => {
  console.error('[ensure-env-admin] failed:', err.message);
  process.exit(1);
});
