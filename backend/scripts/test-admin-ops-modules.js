#!/usr/bin/env node
'use strict';

/**
 * Admin deposits, USDT withdrawals, support, and ledger modules (global USDT — no P2P/MMK ops UI).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminRoles = fs.readFileSync(path.join(ROOT, 'backend/src/lib/adminRoles.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');

assert.ok(adminHtml.includes('data-page="mmk-withdrawals"'), 'withdrawals nav');
assert.ok(!adminHtml.includes('data-page="p2p"'), 'p2p nav removed');
assert.ok(adminHtml.includes('data-page="support"'), 'support nav');
assert.ok(adminHtml.includes('>Withdrawals</span>'), 'withdrawals label');
assert.ok(!adminHtml.includes('>P2P</span>'), 'p2p label removed');
assert.ok(adminHtml.includes('>Support</span>'), 'support label');
assert.ok(!adminHtml.includes('id="tabP2p"'), 'p2p page removed');
assert.ok(!adminHtml.includes('id="mmkWithdrawalsTable"'), 'MMK bank table removed');
assert.ok(adminHtml.includes('id="usdtWithdrawalsTable"'), 'USDT table on withdrawals page');
assert.ok(adminHtml.includes('value="pending" selected>Pending'), 'USDT filter defaults to Pending');
assert.ok(adminHtml.includes('id="ledgerUsdtBreakdown"'), 'USDT escrow breakdown kept');
assert.ok(!adminHtml.includes('id="ledgerTotalMmk"'), 'MMK ledger card removed');
assert.ok(adminHtml.includes('value="approved">Approved'), 'deposit approved filter');
assert.ok(adminHtml.includes('value="rejected">Rejected'), 'deposit rejected filter');
assert.ok(adminHtml.includes('value="completed">Closed'), 'support closed status');
assert.ok(adminHtml.includes('>Mark Closed<'), 'close ticket button');
assert.ok(adminHtml.includes('id="supportReplyForm"'), 'admin reply form');
assert.ok(adminHtml.includes('id="supportTicketModal"'), 'support ticket modal');
assert.ok(adminHtml.includes('admin.js?v=20261010globalUsdtAdmin'), 'admin cache');

const depositsBlock = adminHtml.slice(
  adminHtml.indexOf('id="tabDeposits"'),
  adminHtml.indexOf('id="tabMmkWithdrawals"')
);
assert.ok(!depositsBlock.includes('id="mmkWithdrawalsTable"'), 'MMK table not on deposits');
assert.ok(!depositsBlock.includes('data-nav-page="mmk-withdrawals"'), 'no MMK withdrawal tip on deposits');

assert.ok(adminJs.includes("'mmk-withdrawals'"), 'core pages include withdrawals');
assert.ok(!adminJs.includes("'p2p',\n"), 'p2p removed from core pages');
assert.ok(adminJs.includes("'support'"), 'core pages include support');
assert.ok(adminJs.includes("name === 'mmk-withdrawals'"), 'withdrawals tab loads');
assert.ok(adminJs.includes('renderLedgerSummary'), 'ledger summary loader');
assert.ok(adminJs.includes('escrow_breakdown'), 'escrow breakdown preserved');
assert.ok(adminJs.includes('payout_method !== \'bank\''), 'bank rows hidden from TRC20 queue');
assert.ok(adminJs.includes('financeStatusBadge'), 'pending/approved/rejected badges');
assert.ok(adminJs.includes("completed: 'Closed'"), 'support closed label');
assert.ok(adminJs.includes('async loadSupportThreads()'), 'support inbox loader');

assert.ok(adminRoles.includes("'mmk-withdrawals': 'withdrawals'"), 'withdrawals page permission');
assert.ok(adminRoutes.includes("if (status === 'approved') status = 'VERIFIED'"), 'approved maps to VERIFIED');

const { pagesForRole, ROLES } = require('../src/lib/adminRoles');
const superPages = pagesForRole(ROLES.SUPER_ADMIN);
assert.ok(superPages.includes('support'), 'super admin can open support');
assert.ok(superPages.includes('mmk-withdrawals'), 'super admin can open withdrawals');
const financePages = pagesForRole(ROLES.FINANCE_ADMIN);
assert.ok(financePages.includes('mmk-withdrawals'), 'finance sees withdrawals');
assert.ok(!financePages.includes('support'), 'finance does not get support inbox');
const supportPages = pagesForRole(ROLES.SUPPORT_ADMIN);
assert.ok(supportPages.includes('support'), 'support admin sees inbox');
assert.ok(!supportPages.includes('mmk-withdrawals'), 'support admin does not approve payouts');

console.log('Admin ops modules — ok');
