#!/usr/bin/env node
/**
 * Admin panel: USDT-only user balances + USDT→MMK withdrawal display; keep daily rate.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'backend/src/services/settingsService.js'), 'utf8');

// 1) Daily exchange rate controls kept
assert.ok(adminHtml.includes('id="adminCurrentRateBadge"'), 'rate badge in admin header');
assert.ok(adminHtml.includes('id="withdrawalRatesForm"'), 'withdrawal rates form');
assert.ok(adminHtml.includes('id="wrExchangeRate"'), 'USDT→MMK rate input');
assert.ok(adminJs.includes('updateRateBadge'), 'rate badge updater');
assert.ok(adminJs.includes('loadWithdrawalRates'), 'loads withdrawal rates');

// 2) Users table has USDT only (no MMK Wallet column in loadUsers output)
const loadUsersIdx = adminJs.indexOf('async loadUsers()');
const loadUsersEnd = adminJs.indexOf('async loadTransactions()', loadUsersIdx);
assert.ok(loadUsersIdx >= 0 && loadUsersEnd > loadUsersIdx, 'loadUsers markers');
const loadUsersFn = adminJs.slice(loadUsersIdx, loadUsersEnd);
assert.ok(loadUsersFn.includes('USDT Wallet'), 'USDT Wallet column present');
assert.ok(!loadUsersFn.includes('MMK Wallet'), 'MMK Wallet column removed from users table');
assert.ok(!loadUsersFn.includes('adj-mmk-wallet'), 'Adjust MMK row action removed');
assert.ok(loadUsersFn.includes('adj-usdt-wallet'), 'Adjust USDT row action kept');

// 3) USDT withdrawal bank rows show rate + MMK to send
const wdIdx = adminJs.indexOf('async loadUsdtWithdrawals()');
const wdEnd = adminJs.indexOf('async loadMmkWithdrawals()', wdIdx);
assert.ok(wdIdx >= 0 && wdEnd > wdIdx, 'loadUsdtWithdrawals markers');
const wdFn = adminJs.slice(wdIdx, wdEnd);
assert.ok(wdFn.includes('MMK to Send'), 'MMK to Send column');
assert.ok(wdFn.includes('1 USDT ='), 'rate label uses daily locked rate');
assert.ok(wdFn.includes('Send via bank / KPay / WavePay'), 'local payout hint');
assert.ok(wdFn.includes('Mark MMK Sent'), 'bank complete action label');
assert.ok(wdFn.includes('data-mmk='), 'MMK amount on complete button');

assert.ok(settings.includes('function calculateWithdrawalBreakdown'), 'backend still computes MMK from rate');
assert.ok(adminHtml.includes('USDT→MMK'), 'admin copy mentions USDT→MMK bank flow');

console.log('Admin USDT balances + USDT→MMK withdrawals — ok');
