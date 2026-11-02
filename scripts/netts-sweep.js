#!/usr/bin/env node
'use strict';

/**
 * Standalone Netts TRON HD deposit auto-sweep (Droplet / local — uses backend .env).
 *
 * Same logic as POST /api/admin/tron/auto-sweep (Netts /order1h + USDT → master).
 * TCP egress is this host (use DigitalOcean Droplet so Netts whitelist matches).
 *
 * Usage:
 *   node scripts/netts-sweep.js --status [--limit=500]
 *   node scripts/netts-sweep.js --dry-run --all [--limit=50]
 *   node scripts/netts-sweep.js --all [--limit=500]
 *   node scripts/netts-sweep.js --user-id=42 [--dry-run]
 *
 * Env: TRON_ENERGY_API_URL, TRON_ENERGY_API_KEY, TRON_NETTS_REAL_IP, DATABASE_URL, …
 * Verify: node backend/scripts/verify-droplet-sweep-env.js
 */
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', 'backend');
process.chdir(BACKEND_ROOT);
require(path.join(BACKEND_ROOT, 'src/lib/loadEnv'));

function parseArgs(argv) {
  const opts = {
    status: false,
    dryRun: false,
    all: false,
    forceGas: false,
    skipPreflight: false,
    userId: null,
    limit: 500,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--status' || arg === '--verify') opts.status = true;
    else if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--force-gas') opts.forceGas = true;
    else if (arg === '--skip-preflight') opts.skipPreflight = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--user-id=')) opts.userId = Number(arg.slice('--user-id='.length));
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length));
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 1) opts.limit = 500;
  opts.limit = Math.min(Math.floor(opts.limit), 5000);
  return opts;
}

function printUsage() {
  console.log(`Netts auto-sweep CLI (backend env + Turso)

Commands:
  --status [--limit=N]     Env, Netts readiness, preflight (no transfers)
  --dry-run --all          Simulate sweep for up to N custodial addresses
  --all                    Live sweep (Netts energy + USDT to master)
  --user-id=<id>           Single-user sweep

Options:
  --limit=N                Max HD deposit addresses (default 500, max 5000)
  --force-gas              Legacy gas path (Netts is default)
  --skip-preflight         Live run only — not recommended
  --json                   Print JSON result on stdout
  -h, --help

Examples:
  node scripts/netts-sweep.js --status
  node scripts/netts-sweep.js --dry-run --all --limit=10
  node scripts/netts-sweep.js --all --limit=200

Run from repo root; loads backend/.env and backend/.env.local.`);
}

function printHumanStatus(status) {
  const pre = status.preflight || {};
  const netts = status.netts || pre.netts || {};
  console.log('[netts-sweep] status');
  console.log('  env_ok:', status.env_ok);
  console.log('  ready:', status.ready);
  console.log('  transfers_paused:', status.transfers_paused);
  console.log('  in_flight:', status.in_flight);
  console.log('  address_count:', status.address_count);
  console.log('  min_usdt:', status.min_usdt);
  console.log(
    '  netts:',
    netts.configured ? 'configured' : 'missing URL/key',
    '| real_ip:',
    netts.real_ip_valid ? 'ok' : 'TRON_NETTS_REAL_IP invalid/missing',
  );
  if (pre.blockers?.length) {
    console.log('  preflight blockers:', pre.blockers.join(', '));
  }
  const failed = (status.env_checks || []).filter((c) => !c.ok).map((c) => c.id);
  if (failed.length) console.log('  env failed:', failed.join(', '));
}

function printHumanSweep(payload) {
  const s = payload.sweep || {};
  console.log('[netts-sweep]', payload.message || 'done');
  console.log(
    '  checked:', s.checked,
    'swept:', s.swept,
    'skipped:', s.skipped,
    'failed:', s.failed,
    'dry_run:', payload.dry_run,
  );
  if (payload.total_usdt != null && Number(payload.total_usdt) > 0) {
    console.log('  total_usdt:', payload.total_usdt, 'transfers:', payload.transfer_count);
  }
  for (const r of s.results || []) {
    if (r.skipped) {
      console.log(`  SKIP user=${r.userId} ${r.reason || ''}`);
    } else if (r.ok === false) {
      console.log(`  FAIL user=${r.userId} ${r.error || r.code || ''}`);
    } else {
      console.log(
        `  OK user=${r.userId} usdt=${r.usdt?.amountUsdt ?? r.usdtBalance ?? '?'}`
        + (r.usdt?.txId ? ` tx=${String(r.usdt.txId).slice(0, 16)}…` : ''),
      );
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  if (!opts.status && !opts.all && !opts.userId) {
    printUsage();
    process.exit(1);
  }

  const { initDb, closeDb } = require(path.join(BACKEND_ROOT, 'src/db'));
  await initDb();

  try {
    const {
      buildAutoSweepStatus,
      executeAdminAutoSweep,
    } = require(path.join(BACKEND_ROOT, 'src/services/adminTronAutoSweepService'));

    if (opts.status) {
      const status = await buildAutoSweepStatus({
        limit: opts.limit,
        verifyAddresses: true,
      });
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        printHumanStatus(status);
      }
      if (!status.env_ok) process.exitCode = 1;
      return;
    }

    const body = {
      dry_run: opts.dryRun,
      limit: opts.limit,
      force_gas: opts.forceGas,
      skip_preflight: opts.skipPreflight,
    };
    if (opts.userId) body.user_id = opts.userId;

    console.log(
      '[netts-sweep] starting',
      opts.dryRun ? 'dry-run' : 'LIVE',
      'limit=',
      opts.limit,
      opts.userId ? `user_id=${opts.userId}` : 'all addresses',
    );

    const { payload, httpStatus } = await executeAdminAutoSweep(body, {
      adminUserId: null,
      source: 'cli_netts_sweep',
    });

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printHumanSweep(payload);
    }

    if (httpStatus >= 400 || payload.success === false) {
      process.exitCode = 1;
    } else if ((payload.sweep?.failed || 0) > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeDb?.();
  }
}

main().catch((err) => {
  console.error('[netts-sweep] FATAL:', err.message, err.code || '');
  process.exit(1);
});
