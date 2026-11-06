#!/usr/bin/env node
'use strict';

/**
 * New virtual cards are issued on Visa BIN 404 with no BIN picker.
 * Run: node backend/scripts/test-pago-card-default-bin.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pagoCardService.js'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(!doc.includes('id="pagoCardProduct"'), 'BIN / product dropdown is gone');
  assert.ok(!doc.includes('us_493_visa_bin_v2'), '493 option is not offered');
  assert.ok(!doc.includes('us_493_visa_atm'), 'ATM option is not offered');
  assert.ok(!doc.includes('536_master'), 'Mastercard option is not offered');
  assert.ok(!doc.includes('>Visa (404)<'), '404 is not a selectable option');
  assert.ok(doc.includes('id="pagoCardRequestForm"'), 'request form remains');
  assert.ok(doc.includes('BIN 404'), 'request copy names the default BIN');
}

const requestFn = dash.slice(dash.indexOf('async submitPagoCardRequest'), dash.indexOf('async loadAllCards'));
assert.ok(requestFn.includes("product_code: 'us_404_visa_bin'"), 'client always requests BIN 404');
assert.ok(!requestFn.includes('pagoCardProduct'), 'client does not read a BIN select');

assert.ok(i18n.includes("pago_request_hint: 'A Visa card is issued on BIN 404."), 'EN hint');
assert.ok(i18n.includes("pago_request_hint: 'Visa ကဒ်ကို BIN 404 ဖြင့် ထုတ်ပေးသည်။"), 'MY hint');

const requestRoute = routes.slice(
  routes.indexOf("router.post('/cards/request'"),
  routes.indexOf("router.post('/cards/sync'")
);
assert.ok(requestRoute.includes('productCode: DEFAULT_ISSUE_PRODUCT'), 'create route uses the default BIN');
assert.ok(!requestRoute.includes('req.body?.product_code'), 'create route ignores a caller-supplied BIN');

assert.ok(service.includes("const DEFAULT_ISSUE_PRODUCT = 'us_404_visa_bin'"), 'default product is Visa 404');
assert.ok(service.includes('DEFAULT_ISSUE_PRODUCT,'), 'default product is exported');

const { DEFAULT_ISSUE_PRODUCT, PAGO_PRODUCTS } = require('../src/services/pagoCardService');
assert.strictEqual(DEFAULT_ISSUE_PRODUCT, 'us_404_visa_bin');
assert.ok(PAGO_PRODUCTS.some((item) => item.code === DEFAULT_ISSUE_PRODUCT));

console.log('pago card default BIN checks passed');
