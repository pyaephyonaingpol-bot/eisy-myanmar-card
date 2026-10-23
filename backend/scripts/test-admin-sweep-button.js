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
assert.ok(html.includes('data-tron-auto-sweep'), 'Auto-sweep buttons in admin.html');
assert.ok(html.includes('data-tron-auto-sweep-dry-run'), 'Dry-run sweep buttons in admin.html');
assert.ok(html.includes('id="btnAutoSweepOverview"'), 'Overview auto-sweep button present');
assert.ok(html.includes('id="btnAutoSweepPanel"'), 'Panel auto-sweep button present');
assert.ok((html.match(/Auto-sweep \(Netts\)/g) || []).length >= 2, 'Overview and panel expose auto-sweep');
assert.ok(html.includes('data-page="overview"'), 'Master Wallet page is in the admin shell');
assert.ok(html.includes('>Master Wallet<'), 'sidebar links to Master Wallet');
assert.ok(js.includes("'overview'"), 'overview is a core admin page');
assert.ok(!js.includes("name === 'overview' || name === 'transactions'"), 'overview is not redirected away');
assert.ok(js.includes('Auto-sweep (Netts)'), 'button label restores after sweep');
assert.ok(js.includes('formatTronSweepDetailLog'), 'Sweep detail log formatter exists');
assert.ok(js.includes('total_usdt'), 'UI reads total_usdt from API');
assert.ok(
  route.includes('total_usdt') || fs.readFileSync(path.join(ROOT, 'src/services/adminTronAutoSweepService.js'), 'utf8').includes('total_usdt'),
  'API returns total_usdt swept'
);
assert.ok(service.includes('summarizeSweepTransferTotals'), 'Service aggregates sweep USDT totals');
assert.ok(service.includes('sweepUsdtWithNettsEnergy'), 'Service uses Netts energy sweep helper');
assert.ok(service.includes('buildSweepPreflightReport'), 'Service exposes sweep preflight');
assert.ok(route.includes("'/sweep-preflight'"), 'Admin preflight route exists');
assert.ok(js.includes('preflight'), 'Admin UI reads sweep preflight');
assert.ok(html.includes('id="masterWalletSweepMinLabel"'), 'Min USDT label present');
assert.ok(
  /id="masterWalletSweepMinLabel">\s*25\s*</.test(html),
  'Default threshold label shows 25'
);
assert.ok(html.includes('id="masterWalletSweepStatus"'), 'Overview sweep status present');
assert.ok(html.includes('id="masterWalletSweepStatusPanel"'), 'Panel sweep status present');
console.log('ok');

section('admin.js wires Sweep → POST /api/admin/tron/auto-sweep');
assert.ok(js.includes('data-tron-auto-sweep'), 'Binds auto-sweep clicks');
assert.ok(js.includes('runTronAutoSweep'), 'runTronAutoSweep helper exists');
assert.ok(js.includes('loadTronAutoSweepStatus'), 'loadTronAutoSweepStatus helper exists');
assert.ok(js.includes('/api/admin/tron/auto-sweep'), 'Calls admin tron/auto-sweep API');
assert.ok(js.includes('dry_run: dryRun'), 'Live vs dry-run sweep body');
assert.ok(route.includes("'/tron/auto-sweep'"), 'tron/auto-sweep route exists');
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
