#!/usr/bin/env node
'use strict';

/**
 * Static checks: Adjust USDT opens a modal instead of scrolling the page.
 * Run: npm run test:admin-balance-adjust-modal
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('admin.html hosts Adjust USDT modal (not inline users-page form)');
assert.ok(html.includes('id="balanceAdjustModal"'), 'balanceAdjustModal present');
assert.ok(html.includes('id="balanceAdjustUsdtForm"'), 'USDT form present');
assert.ok(html.includes('id="balanceAdjustModalClose"'), 'close button present');
assert.ok(html.includes('id="balanceAdjustModalCancel"'), 'cancel button present');
assert.ok(html.includes('balance-adjust-modal-backdrop'), 'backdrop present');
assert.ok(html.includes('admin-form-modal-inner'), 'form panel class present');

const usersIdx = html.indexOf('id="tabUsers"');
const usersEnd = html.indexOf('id="tabTransactions"');
assert.ok(usersIdx >= 0 && usersEnd > usersIdx, 'users and transactions sections found');
const usersChunk = html.slice(usersIdx, usersEnd);
assert.ok(
  !usersChunk.includes('id="balanceAdjustUsdtForm"'),
  'USDT form removed from users page scroll area'
);
assert.ok(
  html.indexOf('id="balanceAdjustUsdtForm"') > html.indexOf('id="balanceAdjustModal"'),
  'form nested inside modal markup'
);
console.log('ok');

section('admin.js opens modal from Adjust USDT row action');
assert.ok(js.includes('openBalanceAdjustModal'), 'openBalanceAdjustModal helper');
assert.ok(js.includes('closeBalanceAdjustModal'), 'closeBalanceAdjustModal helper');
assert.ok(js.includes('adj-usdt-wallet'), 'row action class kept');
assert.ok(js.includes('this.openBalanceAdjustModal('), 'row click opens modal');
assert.ok(
  !js.includes("$('balanceAdjustUsdtForm')?.scrollIntoView"),
  'no scrollIntoView on adjust form'
);
assert.ok(
  js.includes("querySelector('.balance-adjust-modal-backdrop')"),
  'backdrop closes modal'
);
assert.ok(js.includes("key !== 'Escape'"), 'Escape closes modal');
console.log('ok');

section('styles give modal a readable form panel');
assert.ok(css.includes('.admin-form-modal-inner'), 'admin-form-modal-inner styles');
console.log('ok');

console.log('\nAdmin balance adjust modal checks passed.');
