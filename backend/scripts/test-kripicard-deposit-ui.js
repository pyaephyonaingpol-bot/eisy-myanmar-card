#!/usr/bin/env node
/**
 * Assert Instant portal deposit UI uses Kripicard pay_address/pay_amount/network,
 * and withdrawals remain mapped to the legacy TRON master wallet.
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
const withdrawHtml = html.slice(withdrawStart, withdrawStart + 2500);
assert.ok(withdrawHtml.includes('data-payout-system="legacy-tron-master-wallet"'), 'withdraw uses legacy tron');
assert.ok(withdrawHtml.includes('data-withdraw-provider="legacy-tron"'), 'withdraw form legacy-tron');
assert.ok(withdrawHtml.includes('value="TRC20"'), 'TRC20 network option');
assert.ok(!withdrawHtml.includes('data-deposit-provider="kripicard"'), 'withdraw not kripicard deposit');

assert.ok(dash.includes('createKripicardDeposit'), 'dashboard calls createKripicardDeposit');
assert.ok(dash.includes('loadKripicardDepositNetworks'), 'loads Kripicard networks');
assert.ok(dash.includes('formatKripicardNetworkLabel'), 'formats network labels');
assert.ok(dash.includes('pay_address'), 'maps pay_address from response');
assert.ok(dash.includes('pay_amount'), 'maps pay_amount from response');
assert.ok(dash.includes('Legacy Tron Master Wallet') || dash.includes('legacy TRON master wallet'), 'withdraw preview legacy copy');
assert.ok(dash.includes("select.value = 'tron'") || dash.includes("value === 'tron'"), 'defaults to tron network');

assert.ok(depositApi.includes('createKripicardDeposit'), 'depositApi has createKripicardDeposit');
assert.ok(depositApi.includes('/api/deposit/create'), 'depositApi posts /api/deposit/create');
assert.ok(depositApi.includes('getKripicardNetworks'), 'depositApi lists networks');

assert.ok(appView.includes('data-deposit-provider="kripicard"'), 'instantAppView deposit is kripicard');
assert.ok(appView.includes('data-payout-system="legacy-tron-master-wallet"'), 'instantAppView withdraw is legacy tron');
assert.ok(!appView.includes('id="instantAppTrc20Address"'), 'static HD TRC20 address field removed');
assert.ok(appView.includes('data-open-usdt-topup'), 'top-up CTA present');

assert.ok(i18n.includes("btn_deposit_tron: 'Get Pay Address'"), 'EN Get Pay Address');
assert.ok(i18n.includes('deposit_pay_network'), 'deposit_pay_network i18n key');
assert.ok(i18n.includes('instant_kripicard_deposit_hint'), 'instant kripicard hint key');
assert.ok(i18n.includes('Legacy Master Wallet') || i18n.includes('legacy TRON master wallet'), 'withdraw i18n legacy');

console.log('Kripicard deposit UI + legacy Tron withdraw — ok');
