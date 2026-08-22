#!/usr/bin/env node
/**
 * Reconnect / backfill: push historical Turso/LibSQL users & records into Supabase.
 *
 * Requires:
 *   DATABASE_URL + DATABASE_AUTH_TOKEN  (Turso — source of truth)
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (target project)
 *
 * Usage:
 *   node backend/scripts/sync-historical-to-supabase.js
 *   node backend/scripts/sync-historical-to-supabase.js --dry-check
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb, getDatabaseInfo } = require('../src/db');
const { getSupabaseStatus, isSupabaseEnabled, getSupabase } = require('../src/lib/supabase');
const { backfillHistoricalDataToSupabase } = require('../src/services/supabaseSyncService');

async function dryCheck() {
  const status = getSupabaseStatus();
  const dbInfo = getDatabaseInfo();
  console.log('[dry-check] database:', dbInfo);
  console.log('[dry-check] supabase:', status);

  if (!isSupabaseEnabled()) {
    console.error('[dry-check] FAIL — Supabase credentials missing');
    process.exitCode = 1;
    return;
  }

  const sb = getSupabase();
  const { count, error } = await sb.from('user_wallets').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('[dry-check] FAIL — cannot query user_wallets:', error.message);
    console.error('Apply supabase/schema.sql in the Supabase SQL Editor, then retry.');
    process.exitCode = 1;
    return;
  }
  console.log(`[dry-check] OK — connected to ${status.project_host}, user_wallets count=${count ?? 0}`);
}

async function run() {
  const dry = process.argv.includes('--dry-check');
  console.log('[sync-historical] Initializing Turso/LibSQL connection...');
  await initDb();
  console.log('[sync-historical] Source DB:', getDatabaseInfo());

  if (dry) {
    await dryCheck();
    await closeDb();
    return;
  }

  console.log('[sync-historical] Target Supabase:', getSupabaseStatus());
  const result = await backfillHistoricalDataToSupabase();
  if (!result.ok) {
    console.error('[sync-historical] FAILED:', result.error);
    process.exitCode = 1;
  } else {
    console.log('[sync-historical] Backfill complete:');
    console.log(JSON.stringify(result.summary, null, 2));
  }
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
