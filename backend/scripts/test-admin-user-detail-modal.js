#!/usr/bin/env node
'use strict';

/**
 * Admin user detail modal wiring.
 * Run: node backend/scripts/test-admin-user-detail-modal.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(root, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'backend/public/admin.js'), 'utf8');
const detailJs = fs.readFileSync(path.join(root, 'backend/public/adminUserDetail.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/admin.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/adminUserDetailService.js'), 'utf8');

assert.ok(adminHtml.includes('id="userDetailModal"'), 'user detail modal markup');
assert.ok(adminHtml.includes('data-user-detail-tab="finance"'), 'finance tab');
assert.ok(adminHtml.includes('id="userDetailSupportReplyForm"'), 'support reply form');
assert.ok(adminHtml.includes('adminUserDetail.js'), 'modular detail script included');

assert.ok(adminJs.includes('user-directory-row'), 'clickable user rows');
assert.ok(adminJs.includes('openUserDetailModal'), 'row opens modal hook');

assert.ok(detailJs.includes('loadUserDetailProfile'), 'profile loader');
assert.ok(detailJs.includes('/detail/finance'), 'finance API');
assert.ok(detailJs.includes('/detail/cards'), 'cards API');
assert.ok(detailJs.includes('/detail/card-transactions'), 'card tx API');
assert.ok(detailJs.includes('/detail/support/reply'), 'support reply API');

assert.ok(routes.includes("router.get('/users/:userId/detail'"), 'profile route');
assert.ok(routes.includes("router.get('/users/:userId/detail/finance'"), 'finance route');
assert.ok(routes.includes("router.get('/users/:userId/detail/cards'"), 'cards route');
assert.ok(routes.includes("router.post('/users/:userId/detail/support/reply'"), 'support reply route');

assert.ok(service.includes('listUserFinanceDeposits'), 'deposit pagination service');
assert.ok(service.includes('listUserCardSpendTransactions'), 'card spend aggregation');

console.log('admin user detail modal checks passed');
