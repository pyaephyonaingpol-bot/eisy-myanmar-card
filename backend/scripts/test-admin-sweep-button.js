#!/usr/bin/env node
/**
 * Static checks: admin Sweep button + 25 USDT min threshold wiring.
 * Run: node backend/scripts/test-admin-sweep-button.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
const route = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
const service = fs.readFileSync(path.join(ROOT, 'src/services/tronSweepService.js'), 'utf8');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('admin.html exposes Sweep controls');
assert.ok(html.includes('data-tron-deposit-sweep'), 'Sweep buttons use data-tron-deposit-sweep');
assert.ok(html.includes('id="btnSweepDepositsOverview"'), 'Overview Sweep button present');
assert.ok(html.includes('id="btnSweepDepositsPanel"'), 'Panel Sweep button present');
assert.ok(html.includes('id="masterWalletSweepMinLabel"'), 'Min USDT label present');
assert.ok(
  /id="masterWalletSweepMinLabel">\s*25\s*</.test(html),
  'Default threshold label shows 25'
);
assert.ok(html.includes('id="masterWalletSweepStatus"'), 'Overview sweep status present');
assert.ok(html.includes('id="masterWalletSweepStatusPanel"'), 'Panel sweep status present');
console.log('ok');

section('admin.js wires Sweep → POST /api/admin/sweep-deposits');
assert.ok(js.includes("querySelectorAll('[data-tron-deposit-sweep]')"), 'Binds data-tron-deposit-sweep clicks');
assert.ok(js.includes('runTronDepositSweep'), 'runTronDepositSweep helper exists');
assert.ok(js.includes('loadTronSweepConfig'), 'loadTronSweepConfig helper exists');
assert.ok(js.includes('/api/admin/sweep-deposits'), 'Calls admin sweep-deposits API');
assert.ok(js.includes('dry_run: false'), 'Live sweep posts dry_run:false');
assert.ok(js.includes('masterWalletSweepMinLabel'), 'Updates min label from API');
assert.ok(js.includes('?? 25'), 'Client falls back to 25 USDT min');
console.log('ok');

section('API + service enforce configurable min USDT (default 25)');
assert.ok(route.includes("'/sweep-deposits'"), 'sweep-deposits route exists');
assert.ok(route.includes("requirePermission('master_wallet')"), 'Sweep requires master_wallet');
assert.ok(/TRON_SWEEP_MIN_USDT \|\| 25/.test(service), 'Service default min is 25 USDT');
assert.ok(envExample.includes('TRON_SWEEP_MIN_USDT=25'), '.env.example documents 25 USDT default');
console.log('ok');

section('runtime default getMinSweepUsdt() === 25');
delete process.env.TRON_SWEEP_MIN_USDT;
delete require.cache[require.resolve('../src/services/tronSweepService')];
const sweep = require('../src/services/tronSweepService');
assert.strictEqual(sweep.getMinSweepUsdt(), 25);
process.env.TRON_SWEEP_MIN_USDT = '40';
assert.strictEqual(sweep.getMinSweepUsdt(), 40);
delete process.env.TRON_SWEEP_MIN_USDT;
console.log('ok');

console.log('\nAdmin sweep button checks passed.');
