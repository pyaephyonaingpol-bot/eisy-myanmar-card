#!/usr/bin/env node
/**
 * USDT top-up form lives in a centered modal, not inline on the deposits page.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');

const modalStart = html.indexOf('id="usdtTopUpModal"');
const modalEnd = html.indexOf('<!-- ═══ CARD DETAIL MODAL ═══');
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'USDT top-up modal present');
const modalHtml = html.slice(modalStart, modalEnd);

assert.ok(modalHtml.includes('id="usdtDepositForm"'), 'deposit form in modal');
assert.ok(modalHtml.includes('id="btnCreateTronDeposit"'), 'create deposit button in modal');
assert.ok(modalHtml.includes('id="usdtDepositFeePreview"'), 'fee preview in modal');
assert.ok(modalHtml.includes('id="usdtTopUpModalClose"'), 'modal close control');

const pageStart = html.indexOf('data-i18n="deposits_page_title"');
const historyStart = html.indexOf('Deposit &amp; Request History');
assert.ok(pageStart >= 0 && historyStart > pageStart);
const depositsPage = html.slice(pageStart, historyStart);

assert.ok(!depositsPage.includes('id="usdtDepositForm"'), 'form not inline on deposits page');
assert.ok(depositsPage.includes('data-open-usdt-topup'), 'deposits page has open-modal CTA');

assert.ok(dash.includes('openUsdtTopUpModal'), 'dashboard opens modal');
assert.ok(dash.includes('closeUsdtTopUpModal'), 'dashboard closes modal');
assert.ok(dash.includes('bindUsdtTopUpModal'), 'modal bindings registered');
assert.ok(dash.includes('[data-open-usdt-topup]'), 'data-open-usdt-topup wired');
assert.ok(!html.includes('data-deposit-tab="usdt"'), 'legacy inline deposit-tab buttons removed');

console.log('USDT top-up modal UI — ok');
