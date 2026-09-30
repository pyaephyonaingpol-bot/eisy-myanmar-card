/**
 * Assert Instant portal deposit UI uses Kripicard pay_address/pay_amount/network,
 * and withdrawals use Kripicard with 4% markup / 48h processing.
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
const depositApi = fs.readFileSync(path.join(ROOT, 'backend/public/src/services/depositApi.js'), 'utf8');

const modalStart = html.indexOf('id="usdtTopUpModal"');
const modalEnd = html.indexOf('<!-- ═══ CARD DETAIL MODAL ═══');
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'USDT top-up modal present');
const modalHtml = html.slice(modalStart, modalEnd);

assert.ok(modalHtml.includes('data-deposit-provider="kripicard"'), 'modal tagged kripicard');
assert.ok(modalHtml.includes('id="usdtNetwork"'), 'network select present');
assert.ok(modalHtml.includes('value="tron"'), 'default network tron');
assert.ok(modalHtml.includes('min="20"'), 'minimum deposit $20');
assert.ok(modalHtml.includes('id="usdtPayAmountInline"'), 'pay_amount inline display');
assert.ok(modalHtml.includes('id="usdtPayNetworkDisplay"'), 'network display after create');
assert.ok(modalHtml.includes('id="usdtPayNetDisplay"'), 'net credit display');
assert.ok(modalHtml.includes('id="usdtDepositAddress"'), 'pay address element');
assert.ok(modalHtml.includes('Get Pay Address'), 'CTA labels pay address flow');

const withdrawStart = html.indexOf('id="withdrawUsdtModal"');
assert.ok(withdrawStart >= 0, 'withdraw modal present');
const withdrawHtml = html.slice(withdrawStart, withdrawStart + 2800);
assert.ok(withdrawHtml.includes('data-payout-system="kripicard"'), 'withdraw uses kripicard');
assert.ok(withdrawHtml.includes('data-withdraw-provider="kripicard"'), 'withdraw form kripicard');
assert.ok(withdrawHtml.includes('data-processing-hours="48"'), '48h processing attribute');
assert.ok(withdrawHtml.includes('value="TRC20"'), 'TRC20 network option');
assert.ok(/48 hours/i.test(withdrawHtml), '48h copy in withdraw modal');
assert.ok(/4%/i.test(withdrawHtml), '4% fee copy in withdraw modal');

assert.ok(dash.includes('createKripicardDeposit'), 'dashboard calls createKripicardDeposit');
assert.ok(dash.includes('loadKripicardDepositNetworks'), 'loads Kripicard networks');
assert.ok(dash.includes('formatKripicardNetworkLabel'), 'formats network labels');
assert.ok(dash.includes('pay_address'), 'maps pay_address from response');
assert.ok(dash.includes('pay_amount'), 'maps pay_amount from response');
assert.ok(dash.includes('3% Kripicard') || dash.includes('Kripicard · 48h'), 'withdraw preview kripicard copy');
assert.ok(dash.includes("select.value = 'tron'") || dash.includes("value === 'tron'"), 'defaults to tron network');

assert.ok(depositApi.includes('createKripicardDeposit'), 'depositApi has createKripicardDeposit');
assert.ok(depositApi.includes('/api/deposit/create'), 'depositApi posts /api/deposit/create');
assert.ok(depositApi.includes('getKripicardNetworks'), 'depositApi lists networks');

assert.ok(appView.includes('data-deposit-provider="kripicard"'), 'instantAppView deposit is kripicard');
assert.ok(appView.includes('data-payout-system="kripicard"'), 'instantAppView withdraw is kripicard');
assert.ok(!appView.includes('id="instantAppTrc20Address"'), 'static HD TRC20 address field removed');
assert.ok(appView.includes('data-open-usdt-topup'), 'top-up CTA present');

assert.ok(i18n.includes("btn_deposit_tron: 'Get Pay Address'"), 'EN Get Pay Address');
assert.ok(i18n.includes('deposit_pay_network'), 'deposit_pay_network i18n key');
assert.ok(i18n.includes('instant_kripicard_deposit_hint'), 'instant kripicard hint key');
assert.ok(/48 hours/i.test(i18n) && /4%/.test(i18n), 'withdraw i18n has 48h and 4%');

console.log('Kripicard deposit UI + Kripicard withdraw (4%/48h) — ok');
