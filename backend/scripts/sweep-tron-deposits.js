#!/usr/bin/env node
/**
 * Sweep USDT from per-user HD deposit addresses → master wallet.
 *
 * MANUAL ONLY (no cron / no auto job). Prefer the admin API:
 *   POST /api/admin/sweep-deposits
 *   Body: { "dry_run": true } | { "user_id": 42 } | {}
 *
 * CLI alternative:
 *   node backend/scripts/sweep-tron-deposits.js --dry-run --all
 *   node backend/scripts/sweep-tron-deposits.js --user-id=42
 *   node backend/scripts/sweep-tron-deposits.js --all
 *
 * Flow per address:
 *   1. Master wallet sends a small TRX top-up (gas) to the deposit address
 *   2. Wait briefly
 *   3. Deposit address sends all USDT TRC-20 back to the master wallet
 */
'use strict';

const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    all: false,
    forceGas: false,
    userId: null,
    limit: 500,
  };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--force-gas') opts.forceGas = true;
    else if (arg.startsWith('--user-id=')) opts.userId = Number(arg.slice('--user-id='.length));
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length));
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.all && !opts.userId)) {
    console.log(`Usage:
  node scripts/sweep-tron-deposits.js --dry-run --all
  node scripts/sweep-tron-deposits.js --user-id=<id>
  node scripts/sweep-tron-deposits.js --all [--force-gas]

Env: MASTER_PRIVATE_KEY, TRON_HD_MNEMONIC, TRON_SWEEP_GAS_TRX (default 1.1)`);
    process.exit(opts.help ? 0 : 1);
  }

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const sweep = require('../src/services/tronSweepService');
  console.log('[sweep] MANUAL run — gas TRX=', sweep.getSweepGasTrx(), 'min USDT=', sweep.getMinSweepUsdt(),
    'dryRun=', opts.dryRun);

  try {
    const summary = await sweep.runManualSweep({
      userId: opts.userId || null,
      dryRun: opts.dryRun,
      forceGas: opts.forceGas,
      limit: opts.limit,
    });

    if (opts.userId) {
      console.log(JSON.stringify(summary.results?.[0] || summary, null, 2));
    } else {
      for (const r of summary.results || []) {
        if (r.ok === false) {
          console.log(`FAIL user=${r.userId} ${r.error}`);
        } else if (r.skipped) {
          console.log(`SKIP user=${r.userId} addr=${r.depositAddress} reason=${r.reason}`);
        } else {
          console.log(
            `OK user=${r.userId} usdt=${r.usdt?.amountUsdt ?? r.usdtBalance}`
            + ` gasTx=${r.gas?.txId || (r.gas?.skipped ? 'skipped' : 'dry')} `
            + `usdtTx=${r.usdt?.txId || 'dry'}`
          );
        }
      }
      console.log(JSON.stringify({
        ok: summary.ok,
        manual: summary.manual,
        scheduled: summary.scheduled,
        dryRun: summary.dryRun,
        checked: summary.checked,
        swept: summary.swept,
        skipped: summary.skipped,
        failed: summary.failed,
        gasTrx: summary.gasTrx,
        minUsdt: summary.minUsdt,
      }, null, 2));
    }

    if (!summary.ok || summary.failed > 0) process.exitCode = 1;
  } finally {
    await closeDb?.();
  }
}

main().catch((err) => {
  console.error('[sweep] FATAL:', err.message, err.code || '');
  process.exit(1);
});
