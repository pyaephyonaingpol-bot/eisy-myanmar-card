#!/usr/bin/env node
/**
 * Reset all user / platform test balances to 0.
 *
 * Usage (from backend/):
 *   node scripts/reset-test-balances.js
 *   node scripts/reset-test-balances.js --dry-run
 *   node scripts/reset-test-balances.js --usdt-only
 *
 * Requires DATABASE_URL (+ DATABASE_AUTH_TOKEN on Turso / Vercel DB).
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config();

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const usdtOnly = args.has('--usdt-only');

async function main() {
  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    resetAllTestBalances,
    snapshotBalances,
  } = require('../src/services/resetTestBalancesService');

  console.log('[reset-test-balances] Connecting…');
  await initDb();
  const db = getDb();

  const before = await snapshotBalances(db);
  console.log('[reset-test-balances] Before:', JSON.stringify(before, null, 2));

  if (dryRun) {
    console.log('[reset-test-balances] Dry run only — no changes written.');
    await closeDb();
    return;
  }

  const result = await resetAllTestBalances({
    includeMmk: !usdtOnly,
    includeCards: true,
    cancelPendingWithdrawals: true,
    syncSupabase: true,
    createdBy: 'cli',
    reason: 'CLI test balance reset — synced with new master wallet',
  });

  console.log('[reset-test-balances] Changes:', JSON.stringify(result.changes, null, 2));
  console.log('[reset-test-balances] After:', JSON.stringify(result.after, null, 2));
  console.log('[reset-test-balances] Master wallet:', JSON.stringify(result.master_wallet, null, 2));
  console.log('[reset-test-balances] Done.');
  await closeDb();
}

main().catch((err) => {
  console.error('[reset-test-balances] FAILED:', err.message);
  process.exit(1);
});
