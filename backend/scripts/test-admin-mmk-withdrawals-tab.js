#!/usr/bin/env node
/**
 * Admin panel: USDT TRC20 withdrawals tab (legacy MMK bank queue UI retired).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminRoles = fs.readFileSync(path.join(ROOT, 'backend/src/lib/adminRoles.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');

assert.ok(adminHtml.includes('data-page="mmk-withdrawals"'), 'nav/page withdrawals present');
assert.ok(adminHtml.includes('id="tabMmkWithdrawals"'), 'dedicated withdrawals section');
assert.ok(adminHtml.includes('id="usdtWithdrawalsTable"'), 'USDT withdrawals table');
assert.ok(adminHtml.includes('id="usdtWithdrawalFilter"'), 'status filter');
assert.ok(adminHtml.includes('value="pending" selected>Pending'), 'default pending filter');
assert.ok(!adminHtml.includes('id="mmkWithdrawalsTable"'), 'MMK bank table removed from UI');
assert.ok(adminHtml.includes('TRC20'), 'TRC20 copy present');

const depositsBlock = adminHtml.slice(
  adminHtml.indexOf('id="tabDeposits"'),
  adminHtml.indexOf('id="tabMmkWithdrawals"')
);
assert.ok(!depositsBlock.includes('id="usdtWithdrawalsTable"'), 'USDT table not embedded in Deposits');

assert.ok(adminRoles.includes("'mmk-withdrawals': 'withdrawals'"), 'page permission mapped to withdrawals');

assert.ok(adminJs.includes("name === 'mmk-withdrawals'"), 'tab switch loads USDT withdrawals');
assert.ok(adminJs.includes('async loadUsdtWithdrawals()'), 'loadUsdtWithdrawals kept');
assert.ok(adminJs.includes("payout_method !== 'bank'"), 'bank payout rows hidden');
assert.ok(adminJs.includes('async reviewUsdtWithdrawal('), 'reviewUsdtWithdrawal handler');

assert.ok(adminRoutes.includes("router.get('/withdrawals/usdt'"), 'GET usdt withdrawals route');

console.log('Admin USDT withdrawals tab — ok');
