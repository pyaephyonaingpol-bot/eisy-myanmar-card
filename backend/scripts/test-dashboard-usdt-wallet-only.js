#!/usr/bin/env node
/**
 * Assert dashboard Wallet Overview renders USDT only (no MMK wallet card).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');

const homeStart = html.indexOf('id="pageHome"');
const homeEnd = html.indexOf('id="pageCards"');
assert.ok(homeStart >= 0 && homeEnd > homeStart, 'dashboard home page markers');
const homeHtml = html.slice(homeStart, homeEnd);

assert.ok(homeHtml.includes('id="walletHeroUsdt"'), 'USDT wallet card present');
assert.ok(homeHtml.includes('id="sumBalanceUsdt"'), 'USDT balance display present');
assert.ok(!homeHtml.includes('id="walletHeroMmk"'), 'MMK wallet card removed');
assert.ok(!homeHtml.includes('id="sumBalanceMmk"'), 'MMK balance display removed');
assert.ok(!homeHtml.includes('header_mmk_wallet'), 'MMK wallet label removed from home');
assert.ok(!/MMK Wallet/i.test(homeHtml), 'no MMK Wallet heading on home');
assert.ok(!homeHtml.includes('btnOpenWithdrawMmk'), 'Withdraw to Bank not on home MMK card');
assert.ok(homeHtml.includes('wallet-overview-grid'), 'single-wallet overview grid');

console.log('Dashboard home shows USDT wallet only — ok');
