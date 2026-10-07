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
const depositJs = fs.readFileSync(path.join(ROOT, 'backend/src/routes/deposit.js'), 'utf8');
const webhookJs = fs.readFileSync(path.join(ROOT, 'backend/src/routes/webhook.js'), 'utf8');

const modalStart = html.indexOf('id="usdtTopUpModal"');
const modalEnd = html.indexOf('<!-- ═══ SELL USDT');
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'USDT top-up modal present');
const modalHtml = html.slice(modalStart, modalEnd);

assert.ok(modalHtml.includes('data-deposit-provider="tron-hd"'), 'modal tagged tron-hd');
assert.ok(modalHtml.includes('id="usdtDepositAddress"'), 'deposit address element');
assert.ok(modalHtml.includes('id="usdtQrCode"'), 'QR element');
assert.ok(modalHtml.includes('id="btnCopyUsdtAddress"'), 'copy address button');
assert.ok(!modalHtml.includes('Get Pay Address'), 'pay-address CTA removed');

assert.ok(dash.includes("Auth.api('GET', '/api/tron/wallet/address')"), 'loads TRON HD address');
assert.ok(dash.includes('paintTronHdDeposit'), 'paints address and QR');
assert.ok(!dash.includes('/services/purchase'), 'hub purchase API removed');

assert.ok(appView.includes('data-deposit-provider="tron-hd"'), 'instant view is tron-hd');
assert.ok(appView.includes('id="instantTronHdAddress"'), 'instant address field');
assert.ok(appView.includes('id="instantTronHdQr"'), 'instant QR field');
assert.ok(!appView.includes('instantCardView'), 'card issue view is not mounted');

assert.ok(i18n.includes('TRON HD deposit address') || i18n.includes('TRON HD'), 'i18n describes TRON HD');

assert.ok(!/app\.use\(\s*['"]\/api\/[^'"]*services['"]/.test(indexJs), 'hub routes unmounted');
assert.ok(indexJs.includes('startTronOrderPoller'), 'TRON deposit poller starts');
assert.ok(!indexJs.includes('DepositPoller'), 'retired deposit poller is not started');
assert.ok(!depositJs.includes('-networks'), 'retired network route removed');
assert.ok(!depositJs.includes('-collection'), 'retired collection route removed');
assert.ok(!webhookJs.includes('CARD_PROVIDER_REMOVED'), 'retired provider webhooks removed');

const retiredName = ['kripi', 'card'].join('');
for (const source of [html, dash, i18n, appView, indexJs, depositJs, webhookJs]) {
  assert.ok(!source.toLowerCase().includes(retiredName), 'customer app does not name the retired card provider');
}

console.log('TRON HD deposit UI — ok');
