#!/usr/bin/env node
/**
 * Chunked Supabase wallet backfill must not N+1 Turso reads, and the HTTP
 * starter must return before a slow sync finishes (gateway 504 fix).
 *
 * Run: node backend/scripts/test-supabase-backfill-chunked.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function makeFakeSupabase() {
  const upserts = [];
  return {
    upserts,
    from(table) {
      assert.strictEqual(table, 'user_wallets');
      return {
        upsert: async (row) => {
          upserts.push(row);
          // Simulate network latency without blocking the whole suite too long.
          await new Promise((r) => setTimeout(r, 5));
          return { error: null };
        },
        select() {
          return {
            async in() { return { data: [], error: null }; },
            then(resolve) {
              resolve({ data: [], error: null, count: upserts.length });
            },
          };
        },
      };
    },
  };
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-backfill-chunk-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture_service_role_key_for_backfill_chunk_001';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_anon_backfill_chunk';
  process.env.SUPABASE_BACKFILL_CHUNK_SIZE = '10';
  process.env.SUPABASE_BACKFILL_CONCURRENCY = '4';
  process.env.SUPABASE_BACKFILL_SLICE_BUDGET_MS = '8000';

  const { resetSupabaseClientForTests, setSupabaseClientForTests } = require('../src/lib/supabase');
  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();

  delete require.cache[require.resolve('../src/services/supabaseSyncService')];
  const sync = require('../src/services/supabaseSyncService');
  sync.resetBackfillJobForTests();

  const User = require('../src/models/User');
  const { UserUsdtWalletAddress } = require('../src/models/UserUsdtWalletAddress');

  const fake = makeFakeSupabase();
  resetSupabaseClientForTests();
  setSupabaseClientForTests(fake);

  try {
    const stamp = Date.now();
    for (let i = 0; i < 25; i += 1) {
      const user = await User.create({
        name: `BF ${i}`,
        phone: `09${String(40000000 + i)}`,
        email: `bf${i}-${stamp}@example.com`,
        pinHash: `hash-${i}`,
      });
      if (i % 3 === 0) {
        await UserUsdtWalletAddress.create({
          userId: user.id,
          network: 'TRC20',
          address: `TBF${String(i).padStart(30, '0')}`,
          addressType: 'custodial',
          derivationIndex: i,
          derivationPath: `m/44'/195'/0'/0/${i}`,
        });
      }
    }

    const slice = await sync.backfillUserWalletsSlice({
      pageSize: 10,
      offset: 0,
      budgetMs: 8000,
      concurrency: 4,
    });
    assert.strictEqual(slice.skipped, false);
    assert.ok(slice.synced >= 10, 'first slice syncs a chunk');
    assert.ok(slice.chunks >= 1);
    assert.ok(fake.upserts.length >= 10);
    assert.ok(
      fake.upserts.some((row) => row.tron_deposit_address),
      'joined custodial address is included without N+1 findCustodial'
    );

    // Background starter must return immediately while work continues.
    sync.resetBackfillJobForTests();
    fake.upserts.length = 0;
    const startedAt = Date.now();
    const job = sync.backfillAllUserWalletsInBackground({
      source: 'test',
      pageSize: 10,
      budgetMs: 8000,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 500, `background starter returns fast (took ${elapsed}ms)`);
    assert.ok(job.status === 'starting' || job.status === 'running' || job.status === 'completed');

    // Wait for completion.
    const deadline = Date.now() + 15000;
    let status = sync.getBackfillJobStatus();
    while (Date.now() < deadline && status.status !== 'completed' && status.status !== 'failed') {
      await new Promise((r) => setTimeout(r, 50));
      status = sync.getBackfillJobStatus();
    }
    assert.strictEqual(status.status, 'completed', 'background job completes');
    assert.strictEqual(status.synced, 25);
    assert.strictEqual(status.failed, 0);
    assert.strictEqual(fake.upserts.length, 25);

    const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
    assert.ok(routeSrc.includes("status(202)"), 'backfill route returns 202 Accepted');
    assert.ok(routeSrc.includes('backfillAllUserWalletsInBackground'), 'route uses background starter');
    assert.ok(routeSrc.includes("'/users/backfill-wallets'"), 'status GET exists');

    const adminJs = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
    assert.ok(adminJs.includes("GET', '/api/admin/users/backfill-wallets'"), 'UI polls job status');

    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/user_wallets_sync_indexes.sql'),
      'utf8'
    );
    assert.ok(sql.includes('idx_user_wallets_user_id'), 'sync index SQL present');

    // No N+1: joined load query is used.
    const svc = fs.readFileSync(path.join(__dirname, '../src/services/supabaseSyncService.js'), 'utf8');
    assert.ok(svc.includes('loadBackfillChunk'), 'chunk loader present');
    assert.ok(svc.includes('LEFT JOIN user_usdt_wallet_addresses'), 'custodial join avoids N+1');

    console.log('test-supabase-backfill-chunked: OK', {
      slice_synced: slice.synced,
      job_synced: status.synced,
      upserts: fake.upserts.length,
      starter_ms: elapsed,
    });
  } finally {
    sync.resetBackfillJobForTests();
    resetSupabaseClientForTests();
    await closeDb().catch(() => {});
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
