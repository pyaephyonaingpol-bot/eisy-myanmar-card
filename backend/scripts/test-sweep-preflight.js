#!/usr/bin/env node
'use strict';

/**
 * Sweep preflight + server-side key rejection.
 * Run: node backend/scripts/test-sweep-preflight.js
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  const sweep = require('../src/services/tronSweepService');
  const single = require('../src/services/sweepSingleApiService');

  section('reject private keys in API bodies');
  assert.throws(
    () => sweep.assertSweepBodyHasNoPrivateKey({ childPrivateKey: 'abc' }),
    (e) => e.code === 'SWEEP_PRIVATE_KEY_NOT_ALLOWED',
  );
  assert.throws(
    () => single.parseSingleSweepBody({ user_id: 1, private_key: 'deadbeef' }),
    (e) => e.code === 'SWEEP_PRIVATE_KEY_NOT_ALLOWED',
  );
  assert.doesNotThrow(() => single.parseSingleSweepBody({ user_id: 1 }));
  console.log('ok');

  section('formatUsdtAmountFromSun');
  assert.strictEqual(sweep.formatUsdtAmountFromSun('1000000'), '1.000000');
  assert.strictEqual(sweep.formatUsdtAmountFromSun('25123456'), '25.123456');
  console.log('ok');

  section('preflight report shape (env-dependent)');
  const report = await sweep.buildSweepPreflightReport({ verifyAddresses: false, limit: 10 });
  assert.ok(typeof report.ready === 'boolean');
  assert.ok(Array.isArray(report.blockers));
  assert.ok(report.netts && typeof report.netts.configured === 'boolean');
  assert.ok(report.min_usdt >= 0);
  assert.strictEqual(report.child_trx_required, false);
  console.log('ok', 'ready=', report.ready, 'blockers=', report.blockers.join(',') || 'none');

  section('admin route exposes sweep-preflight');
  const adminRoute = require('fs').readFileSync(
    path.join(__dirname, '../src/routes/admin.js'),
    'utf8',
  );
  assert.ok(adminRoute.includes("'/sweep-preflight'"), 'GET /sweep-preflight registered');
  assert.ok(adminRoute.includes('assertSweepPreflightOrThrow'), 'POST sweep-deposits runs preflight');
  console.log('ok');

  console.log('\nSweep preflight checks — ok');
}

main().catch((err) => {
  console.error('\nSweep preflight FAILED:', err);
  process.exit(1);
});
