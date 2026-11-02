#!/usr/bin/env node
'use strict';

/**
 * Admin auto-sweep API + UI wiring.
 * Run: node backend/scripts/test-admin-auto-sweep-api.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
const service = fs.readFileSync(path.join(ROOT, 'src/services/adminTronAutoSweepService.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');

assert.ok(route.includes("'/tron/auto-sweep'"), 'GET/POST tron/auto-sweep registered');
assert.ok(service.includes('executeAdminAutoSweep'), 'service executes sweep');
assert.ok(service.includes('evaluateSweepEnv'), 'service validates env');
assert.ok(service.includes('MASTER_WALLET_TRANSFERS_PAUSED') || service.includes('areMasterWalletTransfersPaused'), 'pause handling');

assert.ok(html.includes('data-tron-auto-sweep'), 'Auto-sweep button in admin.html');
assert.ok(html.includes('data-tron-auto-sweep-dry-run'), 'Dry-run button in admin.html');
assert.ok(js.includes('/api/admin/tron/auto-sweep'), 'Admin UI calls auto-sweep API');
assert.ok(js.includes('runTronAutoSweep'), 'runTronAutoSweep helper');

console.log('test-admin-auto-sweep-api: OK');
