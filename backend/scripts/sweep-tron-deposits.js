#!/usr/bin/env node
/**
 * Sweep USDT from per-user HD deposit addresses → master wallet.
 *
 * Flow per address:
 *   1. Master wallet sends a small TRX top-up (gas) to the deposit address
 *   2. Wait briefly
 *   3. Deposit address sends all USDT TRC-20 back to the master wallet
 *
 * Usage:
 *   node backend/scripts/sweep-tron-deposits.js --dry-run
 *   node backend/scripts/sweep-tron-deposits.js --user-id=42
 *   node backend/scripts/sweep-tron-deposits.js --all
 *   node backend/scripts/sweep-tron-deposits.js --all --force-gas
 *
 * Env:
 *   MASTER_PRIVATE_KEY, TRON_HD_MNEMONIC (or TRON_HD_SEED_HEX)
 *   TRON_SWEEP_GAS_TRX=1.1
 *   TRON_SWEEP_GAS_WAIT_MS=3000
 *   TRON_SWEEP_MIN_USDT=0.01
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
  console.log('[sweep] gas TRX=', sweep.getSweepGasTrx(), 'min USDT=', sweep.getMinSweepUsdt(),
    'dryRun=', opts.dryRun);

  try {
    let summary;
    if (opts.userId) {
      if (!Number.isInteger(opts.userId) || opts.userId <= 0) {
        throw new Error('--user-id must be a positive integer');
      }
      const result = await sweep.sweepUserDeposit(opts.userId, {
        dryRun: opts.dryRun,
        forceGas: opts.forceGas,
      });
      summary = {
        ok: result.ok !== false,
        checked: 1,
        swept: result.skipped ? 0 : 1,
        skipped: result.skipped ? 1 : 0,
        failed: 0,
        results: [result],
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      summary = await sweep.sweepAllCustodialDeposits({
        dryRun: opts.dryRun,
        limit: opts.limit,
        forceGas: opts.forceGas,
        onProgress: (r) => {
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
        },
      });
      console.log(JSON.stringify({
        ok: summary.ok,
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
