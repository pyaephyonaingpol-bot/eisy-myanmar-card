/**
 * Dual app-mode views: Instant (Kripicard/USDT) vs Standard (Bitnob) — zero overlap.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testAppViewFilesIsolated() {
  section('InstantAppView and StandardAppView are fully isolated');
  const instant = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/instantAppView.js'),
    'utf8'
  );
  const standard = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/standardAppView.js'),
    'utf8'
  );
  const switcher = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/appModeSwitcher.js'),
    'utf8'
  );

  assert.ok(instant.includes('instantAppView'));
  assert.ok(instant.includes('USDT Wallet'));
  assert.ok(instant.includes('instantCardView'));
  assert.ok(instant.includes('data-app-mode="instant"'));
  assert.ok(!/bitnob/i.test(instant), 'InstantAppView must not mention Bitnob');
  assert.ok(!instant.includes('standardCardView'));
  assert.ok(!instant.includes('standardDepositAddress'));

  assert.ok(standard.includes('standardAppView'));
  assert.ok(standard.includes('Bitnob'));
  assert.ok(standard.includes('standardCardView'));
  assert.ok(standard.includes('data-app-mode="standard"'));
  assert.ok(!/kripicard/i.test(standard), 'StandardAppView must not mention Kripicard');
  assert.ok(!standard.includes('instantCardView'));
  assert.ok(!standard.includes('instantUsdtBalance'));

  assert.ok(switcher.includes('appModeSwitcher'));
  assert.ok(switcher.includes('appModeActiveHost'));
  assert.ok(switcher.includes('clearHost'));
  assert.ok(switcher.includes('instantAppView'));
  assert.ok(switcher.includes('standardAppView'));
  assert.ok(switcher.includes('setMode'));
  assert.ok(switcher.includes('data-app-mode-switch'));
  assert.ok(switcher.includes('bindAllTracks'));
  assert.ok(
    !switcher.includes('id="appModeSwitch"'),
    'Switcher pills must not share a fixed id (header + shell both mount one)'
  );
  console.log('ok');
}

function testHtmlHostsAppMode() {
  section('HTML hosts app-mode shell + compact header switch');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('id="appModeSwitcherShell"'));
  assert.ok(html.includes('id="appModeSwitchHeader"'));
  assert.ok(html.includes('id="instantAppPageHost"'));
  assert.ok(html.includes('id="standardAppPageHost"'));
  assert.ok(html.includes('data-mode-nav="instant"'));
  assert.ok(html.includes('data-mode-nav="standard"'));
  assert.ok(html.includes('instantAppView.js'));
  assert.ok(html.includes('standardAppView.js'));
  assert.ok(html.includes('appModeSwitcher.js'));
  console.log('ok');
}

function testDashboardWiresAppMode() {
  section('dashboard mounts exclusive app-mode views');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('mountAppModeUi'));
  assert.ok(dash.includes("mountAppModeUi('switch')"));
  assert.ok(dash.includes("mountAppModeUi('instant')"));
  assert.ok(dash.includes("mountAppModeUi('standard')"));
  assert.ok(dash.includes('setAppMode'));
  assert.ok(dash.includes('instantAppView'));
  assert.ok(dash.includes('standardAppView'));
  assert.ok(dash.includes('appModeSwitcher'));
  console.log('ok');
}

function testApisAndRoutesStillIsolated() {
  section('API clients + route modules stay provider-isolated');
  const instantApi = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/services/instantCardApi.js'),
    'utf8'
  );
  const standardApi = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/services/standardCardApi.js'),
    'utf8'
  );
  const instantRoute = fs.readFileSync(path.join(ROOT, 'backend/src/routes/instantCard.js'), 'utf8');
  const standardRoute = fs.readFileSync(path.join(ROOT, 'backend/src/routes/standardCard.js'), 'utf8');

  assert.ok(instantApi.includes('request-instant'));
  assert.ok(!/bitnob/i.test(instantApi));
  assert.ok(standardApi.includes('request-standard'));
  assert.ok(!/kripicard/i.test(standardApi));
  assert.ok(instantRoute.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(!instantRoute.includes('purchaseCardFromUsdtWallet'));
  assert.ok(standardRoute.includes('purchaseCardFromUsdtWallet'));
  assert.ok(!standardRoute.includes('purchaseKripicardFromUsdtWallet'));
  console.log('ok');
}

function main() {
  testAppViewFilesIsolated();
  testHtmlHostsAppMode();
  testDashboardWiresAppMode();
  testApisAndRoutesStillIsolated();
  console.log('\nDual app-mode view checks passed.');
}

main();
