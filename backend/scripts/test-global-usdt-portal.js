#!/usr/bin/env node
'use strict';

/**
 * Global USDT + virtual cards portal (no local MMK/P2P user flows).
 * Run: node backend/scripts/test-global-usdt-portal.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
const p2pRoute = fs.readFileSync(path.join(ROOT, 'backend/src/routes/p2p.js'), 'utf8');
const withdrawalRoute = fs.readFileSync(path.join(ROOT, 'backend/src/routes/withdrawal.js'), 'utf8');
const withdrawalSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/withdrawalService.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');

assert.ok(!html.includes('id="pageP2p"'), 'P2P page removed');
assert.ok(!html.includes('id="p2pBuyModal"'), 'P2P buy modal removed');
assert.ok(!html.includes('id="sellUsdtMmkModal"'), 'MMK convert modal removed');
assert.ok(!html.includes('id="withdrawMmkModal"'), 'MMK withdraw modal removed');
assert.ok(!html.includes('data-page="p2p"'), 'P2P nav removed');
assert.ok(!html.includes('btnSellConvertUsdt'), 'MMK convert CTA removed');
assert.ok(!html.includes('Bank Account (USDT → MMK)'), 'bank payout option removed');
assert.ok(!html.includes('p2pApi.js'), 'p2p client script removed');
assert.ok(html.includes('TRC20 (TRON)'), 'TRC20 withdrawal kept');
assert.ok(html.includes('Virtual Cards') || html.includes('data-goto="cards"'), 'cards CTA on wallet');
assert.ok(html.includes('pagoCardRevealBtn'), 'secure card reveal UI');

assert.ok(dash.includes("getElementById('pageP2p')"), 'P2P bind guarded');
assert.ok(p2pRoute.includes('P2P_RETIRED'), 'user P2P API retired');
assert.ok(withdrawalRoute.includes('MMK_PAYOUT_RETIRED'), 'MMK withdrawal API retired');
assert.ok(!withdrawalRoute.includes("label: 'Bank Account (USDT → MMK)'"), 'fees list is TRC20-only');
assert.ok(withdrawalSvc.includes('MMK_PAYOUT_RETIRED'), 'bank payout blocked in service');

assert.ok(!adminHtml.includes('data-page="p2p"'), 'admin P2P nav removed');
assert.ok(!adminHtml.includes('id="mmkWithdrawalsTable"'), 'admin MMK withdrawal queue removed');
assert.ok(adminHtml.includes('id="ledgerUsdtBreakdown"'), 'admin USDT escrow summary kept');
assert.ok(adminJs.includes('escrow_breakdown'), 'admin ledger still loads escrow breakdown');

console.log('Global USDT portal checks passed.');
