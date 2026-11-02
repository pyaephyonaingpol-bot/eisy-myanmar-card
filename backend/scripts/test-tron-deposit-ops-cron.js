#!/usr/bin/env node
'use strict';

/**
 * TRON deposit ops cron route wiring + Bearer auth.
 * Run: node backend/scripts/test-tron-deposit-ops-cron.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const expressCron = path.join(root, 'backend/src/routes/cron.js');
const nextRoute = path.join(root, 'app/api/cron/tron-deposit-ops/route.ts');
const indexJs = path.join(root, 'backend/src/index.js');
const vercelJson = path.join(root, 'vercel.json');
const cronAuth = path.join(root, 'backend/src/lib/cronAuth.js');
const service = path.join(root, 'backend/src/services/tronDepositOpsCronService.js');
const nettsLib = path.join(root, 'lib/nettsUsdtSweep.js');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('files exist');
assert.ok(fs.existsSync(expressCron), 'Express cron route');
assert.ok(fs.existsSync(nextRoute), 'Next App Router cron route');
assert.ok(fs.existsSync(service), 'tronDepositOpsCronService');
assert.ok(fs.existsSync(nettsLib), 'lib/nettsUsdtSweep.js');

section('Express mounted');
const indexSrc = fs.readFileSync(indexJs, 'utf8');
assert.ok(indexSrc.includes("app.use('/api/cron'"), 'index mounts /api/cron');

section('vercel.json (no platform crons)');
const vercel = JSON.parse(fs.readFileSync(vercelJson, 'utf8'));
const crons = vercel.crons || [];
assert.strictEqual(
  crons.length,
  0,
  'vercel.json must not define crons — DigitalOcean crontab calls the HTTP endpoint',
);

section('cronAuth bearer validation');
const { authorizeCronBearer } = require(cronAuth);
const prev = process.env.CRON_SECRET;
process.env.CRON_SECRET = 'test-cron-secret-value';
assert.strictEqual(authorizeCronBearer('Bearer wrong').authorized, false);
assert.strictEqual(authorizeCronBearer('Bearer test-cron-secret-value').authorized, true);
assert.strictEqual(authorizeCronBearer('').authorized, false);
if (prev == null) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = prev;

section('route source checks');
const cronSrc = fs.readFileSync(expressCron, 'utf8');
assert.ok(cronSrc.includes('authorizeCronBearer'), 'uses cronAuth');
assert.ok(cronSrc.includes('runTronDepositOpsCron'), 'runs deposit ops job');
assert.ok(cronSrc.includes('success: true'), 'returns success flag');

const nextSrc = fs.readFileSync(nextRoute, 'utf8');
assert.ok(nextSrc.includes('CRON_SECRET'), 'Next route validates CRON_SECRET');
assert.ok(nextSrc.includes('runTronDepositOpsCron'), 'Next route calls service');

console.log('\ntest-tron-deposit-ops-cron: OK');
