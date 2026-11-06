#!/usr/bin/env node
'use strict';

/**
 * Admin Pagocards dashboard wiring (API proxy + Virtual Cards tab UI).
 * Run: node backend/scripts/test-admin-pagocards-dashboard.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(root, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'backend/public/admin.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/admin.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pagoAdminService.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');

assert.ok(adminHtml.includes('id="adminPagoDashboard"'), 'dashboard section in Virtual Cards tab');
assert.ok(adminHtml.includes('id="adminPagoBalanceRow"'), 'wallet balance row');
assert.ok(adminHtml.includes('id="adminPagoCardsTable"'), 'all-cards table mount');
assert.ok(adminHtml.includes('id="adminPagoBrandFilter"'), 'brand filter');
assert.ok(adminHtml.includes('id="adminPagoEmailFilter"'), 'email filter');
assert.ok(adminHtml.includes('id="adminPagoDepositsTable"'), 'deposits log');
assert.ok(adminHtml.includes('id="adminPagoTransactionsTable"'), 'transactions log');

assert.ok(adminJs.includes('loadPagoAdminDashboard'), 'dashboard loader');
assert.ok(adminJs.includes("'/api/admin/pagocards/balance'"), 'balance API wired');
assert.ok(adminJs.includes("'/api/admin/pagocards/allcards'"), 'allcards API wired');
assert.ok(adminJs.includes("'/api/admin/pagocards/deposits'"), 'deposits API wired');
assert.ok(adminJs.includes("'/api/admin/pagocards/transactions'"), 'transactions API wired');

assert.ok(routes.includes("router.get('/pagocards/balance'"), 'admin balance route');
assert.ok(routes.includes("router.post('/pagocards/allcards'"), 'admin allcards route');
assert.ok(routes.includes("router.get('/pagocards/transactions'"), 'admin transactions route');
assert.ok(routes.includes("router.get('/pagocards/deposits'"), 'admin deposits route');
assert.ok(routes.includes('fetchPagoAdminBalance'), 'balance service hook');

assert.ok(service.includes('fetchPagoAdminAllCards'), 'allcards service');
assert.ok(service.includes('enrichAdminCards'), 'local user enrichment');
assert.ok(service.includes('MIN_CARD_REMAINING') === false, 'service file is admin-only');

assert.ok(client.includes('/api/admin/balance'), 'client admin balance path');
assert.ok(client.includes('/api/admin/allcards'), 'client admin allcards path');
assert.ok(client.includes('/api/admin/transactions'), 'client admin transactions path');
assert.ok(client.includes('/api/admin/deposits'), 'client admin deposits path');

console.log('admin pagocards dashboard checks passed');
