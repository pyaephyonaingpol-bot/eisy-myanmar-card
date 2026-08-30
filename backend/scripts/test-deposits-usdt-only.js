#!/usr/bin/env node
/**
 * Assert deposits / top-up page is USDT (TRC20) only — no MMK / KPay / WavePay UI.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
const box = fs.readFileSync(path.join(ROOT, 'backend/public/src/components/usdtAddressBox.js'), 'utf8');

const pageStart = html.indexOf('data-i18n="deposits_page_title"');
const pageEnd = html.indexOf('Deposit &amp; Request History');
assert.ok(pageStart >= 0 && pageEnd > pageStart, 'deposits page markers');
const pageHtml = html.slice(pageStart, pageEnd);

assert.ok(pageHtml.includes('id="depositUsdtPanel"'), 'USDT deposit panel present');
assert.ok(pageHtml.includes('id="usdtDepositForm"'), 'USDT deposit form present');
assert.ok(pageHtml.includes('id="usdtAmount"'), 'USDT amount field present');
assert.ok(pageHtml.includes('TRC20'), 'TRC20 mentioned');
assert.ok(!pageHtml.includes('id="depositMmkPanel"'), 'MMK deposit panel removed');
assert.ok(!pageHtml.includes('deposit_tab_mmk'), 'MMK deposit tab removed');
assert.ok(!pageHtml.includes('id="amountMmk"'), 'MMK amount input removed');
assert.ok(!pageHtml.includes('id="paymentMethod"'), 'bank payment method dropdown removed');
assert.ok(!pageHtml.includes('id="mmkDepositFeePreview"'), 'MMK fee preview removed');
assert.ok(!pageHtml.includes('id="mmkPaymentMethodDetails"'), 'MMK bank details removed');
assert.ok(!/KPay|WavePay|KBZPay/i.test(pageHtml), 'no KPay/WavePay copy in top-up section');
assert.ok(!pageHtml.includes('deposit-type-tabs'), 'deposit type tabs removed');

assert.ok(dash.includes("switchDepositTab('usdt')") || dash.includes('USDT (TRC20) only'), 'dashboard forces USDT tab');
assert.ok(!box.includes("t !== 'mmk'"), 'usdtAddressBox no longer toggles MMK panel');

console.log('Deposits page is USDT-only — ok');
