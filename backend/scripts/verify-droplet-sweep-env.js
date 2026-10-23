#!/usr/bin/env node
/**
 * Droplet / cron readiness for Netts-powered TRON deposit sweep (no secret values printed).
 *
 * Usage (on Droplet, from repo):
 *   cd backend && node scripts/verify-droplet-sweep-env.js
 */
'use strict';

const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

const { envIsSet, firstEnv, tronFullHost } = require('../src/lib/envAliases');

const CHECKS = [
  {
    label: 'TRON_ENERGY_API_URL',
    ok: () => envIsSet('TRON_ENERGY_API_URL'),
    hint: 'Netts order endpoint (e.g. https://netts.io/apiv2/order1h)',
  },
  {
    label: 'TRON_ENERGY_API_KEY',
    ok: () => envIsSet('TRON_ENERGY_API_KEY'),
    hint: 'Netts dashboard API key',
  },
  {
    label: 'TRON_NETTS_REAL_IP',
    ok: () => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(firstEnv('TRON_NETTS_REAL_IP')),
    hint: 'Droplet public IPv4 whitelisted in Netts (X-Real-IP header)',
  },
  {
    label: 'TRON_FULL_HOST',
    ok: () => Boolean(tronFullHost()),
    hint: () => `resolved host: ${(() => { try { return new URL(tronFullHost()).host; } catch { return tronFullHost(); } })()}`,
  },
  {
    label: 'CENTRAL_WALLET_ADDRESS (or MASTER_WALLET_ADDRESS)',
    ok: () => envIsSet('CENTRAL_WALLET_ADDRESS', 'MASTER_WALLET_ADDRESS', 'TRON_MASTER_WALLET'),
    hint: 'USDT sweep destination (master / central hot wallet)',
  },
  {
    label: 'MASTER_PRIVATE_KEY',
    ok: () => envIsSet('MASTER_PRIVATE_KEY', 'MASTER_WALLET_PRIVATE_KEY', 'TRON_MASTER_PRIVATE_KEY'),
    hint: 'HD fallback + master signing',
  },
  {
    label: 'TRON HD seed',
    ok: () => envIsSet('TRON_HD_MNEMONIC', 'TRON_HD_SEED_HEX') || envIsSet('MASTER_PRIVATE_KEY'),
    hint: 'TRON_HD_MNEMONIC preferred, or MASTER_PRIVATE_KEY fallback',
  },
  {
    label: 'TRON API key',
    ok: () => envIsSet('TRON_API_KEY', 'TRONGRID_API_KEY', 'TRON_PRO_API_KEY'),
    hint: 'TronGrid rate limits without a key',
  },
  {
    label: 'DATABASE_URL (+ auth token for Turso)',
    ok: () => {
      const url = firstEnv('DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL');
      if (!url) return false;
      if (/^libsql:\/\//i.test(url) || /turso/i.test(url)) {
        return envIsSet('DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN');
      }
      return true;
    },
    hint: 'Custodial deposit address list lives in Turso/SQLite',
  },
];

async function main() {
  console.log('Droplet TRON sweep env verification (values never printed)\n');

  let failed = 0;
  for (const row of CHECKS) {
    const pass = row.ok();
    const mark = pass ? '✓' : '✗';
    const hint = typeof row.hint === 'function' ? row.hint() : row.hint;
    console.log(`  ${mark} ${row.label}${pass && hint ? `: ${hint}` : ''}`);
    if (!pass) {
      failed += 1;
      if (hint && typeof row.hint === 'string') console.log(`      → ${hint}`);
    }
  }

  let preflightReady = false;
  try {
    const sweep = require('../src/services/tronSweepService');
    const report = await sweep.buildSweepPreflightReport({ verifyAddresses: false, limit: 1 });
    preflightReady = report.ready;
    console.log('\n== sweep preflight (no address verify) ==');
    console.log(`  ready: ${report.ready}`);
    if (report.blockers.length) {
      console.log(`  blockers: ${report.blockers.join(', ')}`);
    }
    if (!report.ready) failed += 1;
  } catch (err) {
    console.error('\nPreflight error:', err.message);
    failed += 1;
  }

  console.log('\nDry-run smoke (optional):');
  console.log('  node scripts/sweep-tron-deposits.js --dry-run --all --limit=1');

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed — fix backend/.env on the Droplet before enabling cron.`);
    process.exit(1);
  }
  console.log('\nAll checks passed' + (preflightReady ? ' — safe to run dry-run / live sweep.' : '.'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
