#!/usr/bin/env node
'use strict';

/**
 * /health/user-mirror must expose Turso vs Supabase wallet counts (no PII)
 * so production mirror completeness can be verified without a local Turso token.
 *
 * Run: node scripts/test-health-user-mirror.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(indexSrc.includes('/health/user-mirror'), 'health user-mirror route registered');
  assert.ok(indexSrc.includes('getUserWalletsMirrorStatus'), 'health route uses mirror helper');
  assert.ok(indexSrc.includes('turso_users'), 'response includes turso_users');
  assert.ok(indexSrc.includes('supabase_wallets'), 'response includes supabase_wallets');
  assert.ok(indexSrc.includes('missing_count'), 'response includes missing_count');
  assert.ok(
    indexSrc.includes('Array.isArray(mirror.missing_user_ids)'),
    'health route derives missing_count from mirror ids'
  );
  assert.ok(
    !/missing_user_ids\s*:/.test(
      indexSrc.slice(indexSrc.indexOf('/health/user-mirror'), indexSrc.indexOf('/health/user-mirror') + 1200)
    ),
    'public JSON payload must not expose missing_user_ids field'
  );

  const dbFile = path.join(os.tmpdir(), `eisy-health-mirror-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.NEXT_PUBLIC_SUPABASE_URL = '';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';

  const { initDb, getDb, closeDb } = require('../src/db');
  await initDb();

  const User = require('../src/models/User');
  for (let i = 0; i < 3; i += 1) {
    await User.create({
      name: `Health ${i}`,
      phone: `09${String(30000000 + i)}`,
      email: `health-${i}-${Date.now()}@example.com`,
      pinHash: `hash-${i}`,
    });
  }

  const sync = require('../src/services/supabaseSyncService');
  const mirror = await sync.getUserWalletsMirrorStatus();
  assert.strictEqual(mirror.turso_total, 3);
  assert.strictEqual(mirror.enabled, false);
  assert.strictEqual(mirror.reason, 'supabase_disabled');

  const payload = {
    status: mirror.in_sync ? 'ok' : (mirror.enabled ? 'degraded' : 'error'),
    turso_users: mirror.turso_total,
    supabase_wallets: mirror.supabase_total,
    missing_count: Array.isArray(mirror.missing_user_ids) ? mirror.missing_user_ids.length : null,
    in_sync: Boolean(mirror.in_sync),
    supabase_enabled: Boolean(mirror.enabled),
  };
  assert.strictEqual(payload.turso_users, 3);
  assert.strictEqual(payload.supabase_enabled, false);
  assert.strictEqual(payload.missing_count, 3);
  assert.ok(!('missing_user_ids' in payload), 'public payload must not include user ids');

  const db = getDb();
  const row = await db.get('SELECT COUNT(*) AS c FROM users');
  assert.strictEqual(Number(row.c), 3);

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }

  console.log('ok — /health/user-mirror reports Turso vs Supabase counts without PII');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
