#!/usr/bin/env node
'use strict';

/**
 * Admin deposits, withdrawals, P2P, and support modules are reachable
 * and use Pending/Approved/Rejected, Dispute release/refund, and Closed tickets.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminRoles = fs.readFileSync(path.join(ROOT, 'backend/src/lib/adminRoles.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
const buySvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/p2pBuyOrderService.js'), 'utf8');
const sellSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/p2pSellOrderService.js'), 'utf8');

assert.ok(adminHtml.includes('data-page="mmk-withdrawals"'), 'withdrawals nav');
assert.ok(adminHtml.includes('data-page="p2p"'), 'p2p nav');
assert.ok(adminHtml.includes('data-page="support"'), 'support nav');
assert.ok(adminHtml.includes('>Withdrawals</span>'), 'withdrawals label');
assert.ok(adminHtml.includes('>P2P</span>'), 'p2p label');
assert.ok(adminHtml.includes('>Support</span>'), 'support label');
assert.ok(adminHtml.includes('id="tabP2p"'), 'p2p page');
assert.ok(adminHtml.includes('id="p2pTrackFilter"'), 'p2p status filter');
assert.ok(adminHtml.includes('value="dispute" selected>Dispute'), 'dispute filter');
assert.ok(adminHtml.includes('value="pending">Pending'), 'pending filter');
assert.ok(adminHtml.includes('value="completed">Completed'), 'completed filter');
assert.ok(adminHtml.includes('id="p2pDisputesTable"'), 'dispute table');
assert.ok(adminHtml.includes('value="approved">Approved'), 'deposit approved filter');
assert.ok(adminHtml.includes('value="rejected">Rejected'), 'deposit rejected filter');
assert.ok(adminHtml.includes('value="completed">Closed'), 'support closed status');
assert.ok(adminHtml.includes('>Mark Closed<'), 'close ticket button');
assert.ok(adminHtml.includes('id="supportReplyForm"'), 'admin reply form');
assert.ok(adminHtml.includes('id="supportTicketModal"'), 'support ticket modal');
assert.ok(adminHtml.includes('data-support-status="pending">Open'), 'open status button');
assert.ok(adminHtml.includes('data-support-status="in_progress">In Progress'), 'in progress status button');
assert.ok(adminHtml.includes('data-support-status="completed">Closed'), 'closed status button');
assert.ok(adminHtml.includes('admin.js?v=20261009ticketModal'), 'admin cache');

const depositsBlock = adminHtml.slice(
  adminHtml.indexOf('id="tabDeposits"'),
  adminHtml.indexOf('id="tabMmkWithdrawals"')
);
assert.ok(!depositsBlock.includes('id="mmkWithdrawalsTable"'), 'MMK table stays on withdrawals page');
assert.ok(!depositsBlock.includes('id="usdtWithdrawalsTable"'), 'USDT withdrawals moved off deposits');
assert.ok(depositsBlock.includes('id="tabP2p"'), 'P2P tab sits before withdrawals');
assert.ok(adminHtml.includes('data-nav-page="mmk-withdrawals"'), 'deposits tip opens withdrawals');

const withdrawalsBlock = adminHtml.slice(adminHtml.indexOf('id="tabMmkWithdrawals"'));
assert.ok(withdrawalsBlock.includes('id="usdtWithdrawalsTable"'), 'USDT table on withdrawals page');
assert.ok(withdrawalsBlock.includes('id="mmkWithdrawalsTable"'), 'MMK table on withdrawals page');
assert.ok(withdrawalsBlock.includes('value="pending" selected>Pending'), 'USDT filter defaults to Pending');

assert.ok(adminJs.includes("'mmk-withdrawals'"), 'core pages include withdrawals');
assert.ok(adminJs.includes("'p2p'"), 'core pages include p2p');
assert.ok(adminJs.includes("'support'"), 'core pages include support');
assert.ok(
  !adminJs.includes("name === 'transactions' || name === 'support' || name === 'mmk-withdrawals'"),
  'support and withdrawals are not redirected away'
);
assert.ok(adminJs.includes("name === 'mmk-withdrawals'"), 'withdrawals tab loads');
assert.ok(adminJs.includes("name === 'p2p'"), 'p2p tab loads');
assert.ok(adminJs.includes('applyP2pTrackFilter'), 'p2p filter loader');
assert.ok(adminJs.includes('financeStatusBadge'), 'pending/approved/rejected badges');
assert.ok(adminJs.includes("isBank ? 'Approve' : 'Complete'"), 'USDT to MMK approve label');
assert.ok(adminJs.includes("completed: 'Closed'"), 'support closed label');
assert.ok(adminJs.includes('async loadSupportThreads()'), 'support inbox loader');
assert.ok(adminJs.includes('openSupportTicketModal'), 'ticket click opens the modal');
assert.ok(adminJs.includes('closeSupportTicketModal'), 'ticket modal can close');
assert.ok(adminJs.includes("'/reply'"), 'admin reply posts to the ticket');

assert.ok(adminRoles.includes("p2p: 'p2p'"), 'p2p page permission');
assert.ok(adminRoles.includes("'mmk-withdrawals': 'withdrawals'"), 'withdrawals page permission');

assert.ok(adminRoutes.includes("if (status === 'approved') status = 'VERIFIED'"), 'approved maps to VERIFIED');
assert.ok(adminRoutes.includes("if (status === 'rejected') status = 'REJECTED'"), 'rejected maps to REJECTED');
assert.ok(buySvc.includes("status === undefined ? 'pending_seller_release' : status"), 'buy status=all lists every row');
assert.ok(sellSvc.includes("status === undefined ? 'pending_merchant_mmk' : status"), 'sell status=all lists every row');

const { pagesForRole, ROLES } = require('../src/lib/adminRoles');
const superPages = pagesForRole(ROLES.SUPER_ADMIN);
assert.ok(superPages.includes('p2p'), 'super admin can open P2P');
assert.ok(superPages.includes('support'), 'super admin can open support');
assert.ok(superPages.includes('mmk-withdrawals'), 'super admin can open withdrawals');
const financePages = pagesForRole(ROLES.FINANCE_ADMIN);
assert.ok(financePages.includes('mmk-withdrawals') && financePages.includes('p2p'), 'finance sees money modules');
assert.ok(!financePages.includes('support'), 'finance does not get support inbox');
const supportPages = pagesForRole(ROLES.SUPPORT_ADMIN);
assert.ok(supportPages.includes('support') && supportPages.includes('p2p'), 'support admin sees inbox and P2P');
assert.ok(!supportPages.includes('mmk-withdrawals'), 'support admin does not approve payouts');

console.log('Admin ops modules — ok');
