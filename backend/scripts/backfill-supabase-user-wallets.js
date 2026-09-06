#!/usr/bin/env node
'use strict';

/**
 * Backfill Supabase user_wallets from every Turso/LibSQL user.
 *
 * Usage:
 *   node scripts/backfill-supabase-user-wallets.js
 *
 * Requires DATABASE_URL (+ DATABASE_AUTH_TOKEN for remote Turso) and
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

async function main() {
  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const {
    backfillAllUserWallets,
    isSupabaseEnabled,
  } = require('../src/services/supabaseSyncService');

  if (!isSupabaseEnabled()) {
    console.error('Supabase is not enabled — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  console.log('Backfilling Supabase user_wallets from Turso users…');
  const result = await backfillAllUserWallets({ pageSize: 50 });
  console.log(JSON.stringify(result, null, 2));

  await closeDb();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
