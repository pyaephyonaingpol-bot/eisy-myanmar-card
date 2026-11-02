#!/usr/bin/env node
/**
 * Droplet sweep env verification (delegates to tronSweepEnvCheck).
 * Usage: cd backend && node scripts/verify-droplet-sweep-env.js
 */
'use strict';

const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

const { evaluateSweepEnv } = require('../src/services/tronSweepEnvCheck');

async function main() {
  console.log('Droplet TRON sweep env verification (values never printed)\n');

  const report = await evaluateSweepEnv({ verifyAddresses: false, preflightLimit: 1 });

  for (const row of report.checks.results) {
    const mark = row.ok ? '✓' : '✗';
    console.log(`  ${mark} ${row.label}${row.ok && row.hint ? `: ${row.hint}` : ''}`);
    if (!row.ok && row.hint) console.log(`      → ${row.hint}`);
  }

  console.log('\n== sweep preflight (no address verify) ==');
  console.log(`  ready: ${report.preflight?.ready}`);
  if (report.preflight?.blockers?.length) {
    console.log(`  blockers: ${report.preflight.blockers.join(', ')}`);
  }

  console.log('\nDry-run smoke:');
  console.log('  node scripts/sweep-tron-deposits.js --dry-run --all --limit=1');

  if (!report.ok) {
    console.log('\nFix backend/.env on the Droplet, then re-run this script.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
