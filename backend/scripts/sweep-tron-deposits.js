#!/usr/bin/env node
/**
 * Sweep USDT from per-user HD deposit addresses → master wallet (Netts energy + TRC-20 transfer).
 *
 * Admin API equivalent: POST /api/admin/sweep-deposits
 *
 * CLI:
 *   node scripts/sweep-tron-deposits.js --dry-run --all --limit=1
 *   node scripts/sweep-tron-deposits.js --all
 *   node scripts/sweep-tron-deposits.js --user-id=42
 *
 * Droplet automation: TRON_SWEEP_SCHEDULER_ENABLED=true in backend/.env (see setup-droplet-sweep-automation.js)
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
    scheduled: false,
    userId: null,
    limit: 500,
  };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--force-gas') opts.forceGas = true;
    else if (arg === '--scheduled') opts.scheduled = true;
    else if (arg.startsWith('--user-id=')) opts.userId = Number(arg.slice('--user-id='.length));
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length));
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sweep-tron-deposits.js --dry-run --all [--limit=N]
  node scripts/sweep-tron-deposits.js --all [--scheduled]
  node scripts/sweep-tron-deposits.js --user-id=<id>

Required env (Droplet — see scripts/verify-droplet-sweep-env.js):
  TRON_ENERGY_API_URL, TRON_ENERGY_API_KEY, TRON_NETTS_REAL_IP
  TRON_FULL_HOST, CENTRAL_WALLET_ADDRESS or MASTER_WALLET_ADDRESS
  MASTER_PRIVATE_KEY, DATABASE_URL (+ token for Turso), TRON HD seed

Verify: node scripts/verify-droplet-sweep-env.js`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.all && !opts.userId)) {
    printUsage();
    process.exit(opts.help ? 0 : 1);
  }

  if (!opts.dryRun) {
    const { assertMasterWalletTransfersAllowed } = require('../src/services/securityFlags');
    try {
      assertMasterWalletTransfersAllowed('USDT deposit sweep');
    } catch (err) {
      console.error(`[sweep] ${err.message}`);
      console.error('[sweep] Use --dry-run to test env and balances without broadcasting.');
      process.exit(1);
    }
  }

  const { evaluateSweepEnv } = require('../src/services/tronSweepEnvCheck');
  const envReport = await evaluateSweepEnv({ verifyAddresses: false, preflightLimit: 1 });
  if (!envReport.ok) {
    const missing = envReport.checks.failed.map((f) => f.id).join(', ')
      || envReport.preflight?.blockers?.join(', ');
    console.error('[sweep] Environment not ready:', missing);
    process.exit(1);
  }

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const sweep = require('../src/services/tronSweepService');
  const modeLabel = opts.scheduled ? 'scheduled' : 'manual';
  console.log(
    `[sweep] ${modeLabel} run — min USDT=`, sweep.getMinSweepUsdt(),
    'netts energy=', sweep.getNettsEnergyPerSweep(),
    'dryRun=', opts.dryRun,
    'limit=', opts.limit,
  );

  try {
    const summary = await sweep.runManualSweep({
      userId: opts.userId || null,
      dryRun: opts.dryRun,
      forceGas: opts.forceGas,
      limit: opts.limit,
      scheduled: opts.scheduled,
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
            + ` usdtTx=${r.usdt?.txId || (opts.dryRun ? 'dry' : 'pending')}`
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
        minUsdt: summary.minUsdt,
        nettsEnergy: summary.nettsEnergy,
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
