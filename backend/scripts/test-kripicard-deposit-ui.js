/**
 * Customer deposits use the per-user TRON HD address and QR.
 * Card-issue pay-address flow and hub catalog purchases are not in the UI.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(ROOT, 'backend/public/i18n.js'), 'utf8');
const appView = fs.readFileSync(path.join(ROOT, 'backend/public/src/components/instantAppView.js'), 'utf8');
const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');

const modalStart = html.indexOf('id="usdtTopUpModal"');
const modalEnd = html.indexOf('<!-- ═══ SELL USDT');
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'USDT top-up modal present');
const modalHtml = html.slice(modalStart, modalEnd);

assert.ok(modalHtml.includes('data-deposit-provider="tron-hd"'), 'modal tagged tron-hd');
assert.ok(modalHtml.includes('id="usdtDepositAddress"'), 'deposit address element');
assert.ok(modalHtml.includes('id="usdtQrCode"'), 'QR element');
assert.ok(modalHtml.includes('id="btnCopyUsdtAddress"'), 'copy address button');
assert.ok(!modalHtml.includes('Get Pay Address'), 'pay-address CTA removed');
assert.ok(!/kripicard/i.test(modalHtml), 'modal has no kripicard copy');

assert.ok(dash.includes("Auth.api('GET', '/api/tron/wallet/address')"), 'loads TRON HD address');
assert.ok(dash.includes('paintTronHdDeposit'), 'paints address and QR');
assert.ok(!dash.includes('/api/kripicard/services/purchase'), 'hub purchase API removed');
assert.ok(!dash.includes('createKripicardDeposit'), 'dashboard does not create kripicard deposits');

assert.ok(appView.includes('data-deposit-provider="tron-hd"'), 'instant view is tron-hd');
assert.ok(appView.includes('id="instantTronHdAddress"'), 'instant address field');
assert.ok(appView.includes('id="instantTronHdQr"'), 'instant QR field');
assert.ok(!appView.includes('instantCardView'), 'card issue view is not mounted');
assert.ok(!/Kripicard/.test(appView), 'instant view has no Kripicard brand');

assert.ok(i18n.includes('TRON HD deposit address') || i18n.includes('TRON HD'), 'i18n describes TRON HD');
assert.ok(!/Kripicard/.test(i18n), 'customer i18n has no Kripicard brand');

assert.ok(!indexJs.includes("app.use('/api/kripicard/services'"), 'hub routes unmounted');
assert.ok(indexJs.includes('startTronOrderPoller'), 'TRON deposit poller starts');
assert.ok(!indexJs.includes('startKripicardDepositPoller'), 'kripicard deposit poller not started');

console.log('TRON HD deposit UI — ok');
