#!/usr/bin/env node
/**
 * Admin manual deposit credit scan wiring (no Vercel cron).
 * Run: node backend/scripts/test-admin-deposit-scan-button.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
const route = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
const vercel = fs.readFileSync(path.join(ROOT, '..', 'vercel.json'), 'utf8');

assert.ok(!JSON.parse(vercel).crons?.length, 'vercel.json has no crons');
assert.ok(html.includes('data-tron-deposit-scan'), 'Deposit scan buttons in admin.html');
assert.ok((html.match(/Trigger Deposit Credit Scan/g) || []).length >= 2);
assert.ok(js.includes('runTronDepositScan'), 'runTronDepositScan in admin.js');
assert.ok(js.includes('/api/admin/scan-deposits'), 'Admin API path wired');
assert.ok(route.includes("'/scan-deposits'"), 'scan-deposits route exists');
assert.ok(route.includes("requirePermission('master_wallet')"), 'scan requires master_wallet');
assert.ok(route.includes('runTronOrderPollSafely'), 'Uses TRON order + HD poll');

console.log('test-admin-deposit-scan-button: OK');
