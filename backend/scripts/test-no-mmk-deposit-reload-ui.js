#!/usr/bin/env node
/**
 * Deposits and card reloads are USDT-only in admin settings and user dashboard.
 * MMK remains available for withdrawals only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');

const pricingStart = adminHtml.indexOf('id="adminSettingsForm"');
const historyStart = adminHtml.indexOf('<h2 style="margin-top:2rem">Exchange Rate History</h2>');
const pricingHtml = adminHtml.slice(pricingStart, historyStart);

assert.ok(!pricingHtml.includes('id="settingMinReloadMmk"'), 'admin: Min MMK reload removed');
assert.ok(pricingHtml.includes('id="settingMinUsdtReload"'), 'admin: Min USDT reload kept');
assert.ok(pricingHtml.includes('id="settingMinMmkWithdrawal"'), 'admin: Min MMK withdrawal kept for withdrawals');
assert.ok(!adminJs.includes('settingMinReloadMmk'), 'admin.js: no Min MMK reload field wiring');

const reloadStart = indexHtml.indexOf('id="reloadCardModal"');
const reloadEnd = indexHtml.indexOf('<!-- ═══ TOP UP USDT WALLET MODAL ═══ -->');
assert.ok(reloadStart >= 0 && reloadEnd > reloadStart, 'reload modal markers');
const reloadHtml = indexHtml.slice(reloadStart, reloadEnd);

assert.ok(!reloadHtml.includes('id="reloadAmountMmk"'), 'reload modal: MMK amount removed');
assert.ok(!reloadHtml.includes('wallet_mmk'), 'reload modal: MMK wallet option removed');
assert.ok(!reloadHtml.includes('reloadProofForm'), 'reload modal: manual proof form removed');
assert.ok(reloadHtml.includes('id="reloadAmountUsdt"'), 'reload modal: USDT amount present');
assert.ok(reloadHtml.includes('value="wallet_usdt"'), 'reload modal: USDT wallet only');

assert.ok(!dash.includes('calculateReloadPreviewClient'), 'dashboard: MMK reload preview removed');
assert.ok(!dash.includes('reloadAmountMmk'), 'dashboard: no MMK reload input refs');
assert.ok(dash.includes("wallet_type: 'usdt'"), 'dashboard: reload submits USDT wallet only');

require('./test-deposits-usdt-only.js');

console.log('No MMK deposit/reload UI — ok');
