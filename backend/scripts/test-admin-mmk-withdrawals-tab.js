#!/usr/bin/env node
/**
 * Admin panel: dedicated MMK bank withdrawals tab for manual approve/reject.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminRoles = fs.readFileSync(path.join(ROOT, 'backend/src/lib/adminRoles.js'), 'utf8');
const mmkModel = fs.readFileSync(path.join(ROOT, 'backend/src/models/MmkWithdrawal.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');

assert.ok(adminHtml.includes('data-page="mmk-withdrawals"'), 'nav/page mmk-withdrawals present');
assert.ok(adminHtml.includes('id="tabMmkWithdrawals"'), 'dedicated MMK withdrawals section');
assert.ok(adminHtml.includes('id="mmkWithdrawalsTable"'), 'MMK withdrawals table');
assert.ok(adminHtml.includes('id="mmkWithdrawalFilter"'), 'status filter');
assert.ok(adminHtml.includes('value="open" selected'), 'default open (pending+processing) filter');
assert.ok(adminHtml.includes('id="mmkWdPendingCount"'), 'pending summary count');
assert.ok(adminHtml.includes('Approve'), 'approve copy present');
assert.ok(adminHtml.includes('Reject'), 'reject copy present');

// Moved out of Deposits — tip button remains, table lives on dedicated tab
assert.ok(adminHtml.includes('data-nav-page="mmk-withdrawals"'), 'deposits tip navigates to MMK tab');
const depositsBlock = adminHtml.slice(
  adminHtml.indexOf('id="tabDeposits"'),
  adminHtml.indexOf('id="tabMmkWithdrawals"')
);
assert.ok(!depositsBlock.includes('id="mmkWithdrawalsTable"'), 'MMK table not embedded in Deposits');

assert.ok(adminRoles.includes("'mmk-withdrawals': 'withdrawals'"), 'page permission mapped to withdrawals');

assert.ok(adminJs.includes("name === 'mmk-withdrawals'"), 'tab switch loads MMK withdrawals');
assert.ok(adminJs.includes('async loadMmkWithdrawals()'), 'loadMmkWithdrawals kept');
assert.ok(adminJs.includes("data-action=\"complete-mmk-wd\""), 'approve action buttons');
assert.ok(adminJs.includes("data-action=\"reject-mmk-wd\""), 'reject action buttons');
assert.ok(adminJs.includes('async reviewMmkWithdrawal('), 'reviewMmkWithdrawal handler');
assert.ok(adminJs.includes('user_balance_mmk'), 'user wallet shown in list');
assert.ok(adminJs.includes('mmk-wd-user-cell'), 'user details cell');
assert.ok(adminJs.includes('mmk-wd-bank-cell'), 'bank details cell');

assert.ok(mmkModel.includes("normalized === 'open'"), 'model supports open status filter');
assert.ok(mmkModel.includes('user_balance_mmk'), 'model joins user balance');
assert.ok(mmkModel.includes('user_email'), 'model joins user email');
assert.ok(mmkModel.includes('user_phone'), 'model joins user phone');

assert.ok(adminRoutes.includes("router.get('/withdrawals/mmk'"), 'GET mmk withdrawals route');
assert.ok(adminRoutes.includes("/withdrawals/mmk/:id/complete"), 'complete route');
assert.ok(adminRoutes.includes("/withdrawals/mmk/:id/reject"), 'reject route');

console.log('Admin MMK withdrawals dedicated tab — ok');
