#!/usr/bin/env node
/**
 * Admin panel: Payment Methods / Bank Settings removed; withdrawal review kept.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
const adminRoles = fs.readFileSync(path.join(ROOT, 'backend/src/lib/adminRoles.js'), 'utf8');

const removedPatterns = [
  'data-page="payment-methods"',
  'tabPaymentMethods',
  'adminPaymentMethodForm',
  'adminPaymentMethodsTable',
  'Payment Methods / Bank Settings',
  'Open Payment Methods',
  'data-goto="payment-methods"',
];

removedPatterns.forEach((pattern) => {
  assert.ok(!adminHtml.includes(pattern), `admin.html should not include: ${pattern}`);
});

assert.ok(!adminJs.includes('loadPaymentMethods'), 'admin.js loadPaymentMethods removed');
assert.ok(!adminJs.includes('savePaymentMethod'), 'admin.js savePaymentMethod removed');
assert.ok(!adminJs.includes('/api/admin/payment-methods'), 'admin.js admin payment-methods API removed');

assert.ok(!adminRoutes.includes("router.get('/payment-methods'"), 'admin routes GET payment-methods removed');
assert.ok(!adminRoutes.includes("router.post('/payment-methods'"), 'admin routes POST payment-methods removed');
assert.ok(!adminRoutes.includes('depositPaymentMethodService'), 'admin routes depositPaymentMethodService import removed');

assert.ok(!adminRoles.includes('payment_methods'), 'adminRoles payment_methods permission removed');
assert.ok(!adminRoles.includes("'payment-methods'"), 'adminRoles payment-methods page removed');

assert.ok(adminHtml.includes('id="usdtWithdrawalsTable"'), 'USDT withdrawal table kept');
assert.ok(adminHtml.includes('id="mmkWithdrawalsTable"'), 'MMK withdrawal table kept');
assert.ok(adminJs.includes('async loadUsdtWithdrawals()'), 'loadUsdtWithdrawals kept');
assert.ok(adminJs.includes('async loadMmkWithdrawals()'), 'loadMmkWithdrawals kept');
assert.ok(adminHtml.includes('id="withdrawalRatesForm"'), 'withdrawal rates form kept');

console.log('Admin payment methods removed; withdrawal management intact — ok');
