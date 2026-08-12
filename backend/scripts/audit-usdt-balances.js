#!/usr/bin/env node
/**
 * Audit: sum of user USDT balances (+ retained float) vs TRON master wallet.
 *
 * Usage (from backend/):
 *   node scripts/audit-usdt-balances.js
 *   node scripts/audit-usdt-balances.js --json
 *   node scripts/audit-usdt-balances.js --skip-chain
 *   node scripts/audit-usdt-balances.js --tolerance 0.10
 *
 * Requires DATABASE_URL (+ DATABASE_AUTH_TOKEN on Turso).
 * On-chain check needs MASTER_WALLET_ADDRESS and/or MASTER_PRIVATE_KEY
 * (TRONGRID_API_KEY strongly recommended).
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config();

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const jsonOut = flags.has('--json');
const skipChain = flags.has('--skip-chain');

function readTolerance() {
  const eq = args.find((a) => a.startsWith('--tolerance='));
  if (eq) return parseFloat(eq.split('=')[1]);
  const idx = args.indexOf('--tolerance');
  if (idx >= 0 && args[idx + 1]) return parseFloat(args[idx + 1]);
  return undefined;
}

async function main() {
  const { initDb, closeDb } = require('../src/db');
  const {
    runUsdtBalanceAudit,
    formatAuditReport,
    DEFAULT_TOLERANCE_USDT,
  } = require('../src/services/usdtBalanceAuditService');

  const toleranceUsdt = readTolerance();
  if (toleranceUsdt != null && !Number.isFinite(toleranceUsdt)) {
    throw new Error('Invalid --tolerance value');
  }

  if (!jsonOut) {
    console.log('[audit-usdt-balances] Connecting to database…');
  }
  await initDb();

  const audit = await runUsdtBalanceAudit({
    skipChain,
    toleranceUsdt: toleranceUsdt ?? DEFAULT_TOLERANCE_USDT,
  });

  if (jsonOut) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    console.log(formatAuditReport(audit));
  }

  await closeDb();

  const status = audit.reconciliation?.verdict?.status;
  if (status === 'synced') process.exit(0);
  if (status === 'chain_unavailable' && skipChain) process.exit(0);
  if (status === 'chain_unavailable') process.exit(2);
  process.exit(1);
}

main().catch((err) => {
  console.error('[audit-usdt-balances] FAILED:', err.message);
  process.exit(1);
});
