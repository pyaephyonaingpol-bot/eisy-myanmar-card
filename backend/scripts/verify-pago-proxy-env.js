#!/usr/bin/env node
/**
 * Pagocards proxy / Droplet IP migration verification.
 * Usage: cd backend && node scripts/verify-pago-proxy-env.js [--probe]
 */
'use strict';

const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

const { evaluatePagoProxyEnv } = require('../src/services/pagoProxyEnvCheck');

async function main() {
  const probe = process.argv.includes('--probe');
  console.log('Pagocards proxy env verification (values never printed)\n');

  const report = await evaluatePagoProxyEnv({ probe, probeTimeoutMs: 15000 });

  for (const row of report.checks.results) {
    const mark = row.ok ? '✓' : '✗';
    console.log(`  ${mark} ${row.label}${row.ok && row.hint ? `: ${row.hint}` : ''}`);
    if (!row.ok && row.hint) console.log(`      → ${row.hint}`);
  }

  if (probe) {
    console.log('\n== live probe (getAdminBalance via proxy) ==');
    if (!report.probe) {
      console.log('  skipped — fix env checks first');
    } else {
      console.log(`  ${report.probe.ok ? '✓' : '✗'} ${report.probe.code}: ${report.probe.message}`);
      if (report.probe.proxyHost) console.log(`  proxy host: ${report.probe.proxyHost}`);
      if (report.probe.hint) console.log(`  → ${report.probe.hint}`);
    }
  } else {
    console.log('\nRun with --probe to test live connectivity (uses PAGO_CARD_* keys).');
  }

  console.log('\nAfter a Droplet IP change:');
  console.log('  1. Whitelist the new public IPv4 in Pagocards merchant settings');
  console.log('  2. Update Vercel PAGO_CARD_API_BASE_URL (or PAGO_CARD_PROXY_HOST)');
  console.log('  3. Set PAGO_CARD_WHITELIST_IP to that IPv4 for local mismatch checks');
  console.log('  4. Ensure the Droplet still serves /api/pago → Pagocards upstream');

  if (!report.ok) {
    console.log('\nFix backend/.env or Vercel env, then re-run this script.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
