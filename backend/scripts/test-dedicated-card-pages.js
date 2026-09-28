/**
 * Dedicated Instant vs Standard pages — no shared toggle / overlapping apply UI.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testPagesExist() {
  section('dedicated Instant + Standard pages in HTML');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('data-page="instant-card"'));
  assert.ok(html.includes('data-page="standard-card"'));
  assert.ok(html.includes('id="pageInstantCard"'));
  assert.ok(html.includes('id="pageStandardCard"'));
  assert.ok(html.includes('data-card-page="instant"'));
  assert.ok(html.includes('data-card-page="standard"'));
  assert.ok(!html.includes('cardProviderSwitch'), 'shared toggle must be removed');
  assert.ok(!html.includes('card-provider-switch-footer'));
  assert.ok(html.includes('kripicardRequestForm'));
  assert.ok(html.includes('cardRequestForm'));
  // Instant form lives only on instant page; Standard form only on standard page.
  const instantIdx = html.indexOf('id="pageInstantCard"');
  const standardIdx = html.indexOf('id="pageStandardCard"');
  const usdtIdx = html.indexOf('id="pageUsdtWallet"');
  assert.ok(instantIdx > 0 && standardIdx > instantIdx);
  const instantBlock = html.slice(instantIdx, standardIdx);
  const standardBlock = html.slice(standardIdx, usdtIdx);
  assert.ok(instantBlock.includes('id="kripicardRequestForm"'));
  assert.ok(!instantBlock.includes('id="cardRequestForm"'), 'Instant page must not host Standard form');
  assert.ok(!instantBlock.includes('standardDepositAddress'));
  assert.ok(standardBlock.includes('id="cardRequestForm"'));
  assert.ok(standardBlock.includes('standardDepositAddress'));
  assert.ok(!standardBlock.includes('id="kripicardRequestForm"'), 'Standard page must not host Instant form');
  console.log('ok');
}

function testDashboardPageLoaders() {
  section('dashboard loads Instant and Standard pages separately');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes("page === 'instant-card'"));
  assert.ok(dash.includes("page === 'standard-card'"));
  assert.ok(dash.includes('enterInstantCardPage'));
  assert.ok(dash.includes('enterStandardCardPage'));
  assert.ok(dash.includes('/api/user/card/request-instant') || dash.includes("request-instant"));
  assert.ok(!dash.includes('setCardProviderTab'));
  assert.ok(!dash.includes('cardProviderSwitch'));
  console.log('ok');
}

function testRouteModulesIsolated() {
  section('API route modules are provider-isolated');
  const instant = fs.readFileSync(path.join(ROOT, 'backend/src/routes/instantCard.js'), 'utf8');
  const standard = fs.readFileSync(path.join(ROOT, 'backend/src/routes/standardCard.js'), 'utf8');
  const user = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');

  assert.ok(instant.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(instant.includes('request-instant'));
  assert.ok(!instant.includes('purchaseCardFromUsdtWallet'));
  assert.ok(!instant.includes('bitnobWalletService'));

  assert.ok(standard.includes('purchaseCardFromUsdtWallet'));
  assert.ok(standard.includes('request-standard'));
  assert.ok(standard.includes('getOrCreateStandardDepositAddress'));
  assert.ok(!standard.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(!standard.includes('kripicardCardWalletService'));

  assert.ok(user.includes("require('./instantCard')"));
  assert.ok(user.includes("require('./standardCard')"));
  console.log('ok');
}

function main() {
  testPagesExist();
  testDashboardPageLoaders();
  testRouteModulesIsolated();
  console.log('\nDedicated Instant/Standard page checks passed.');
}

main();
