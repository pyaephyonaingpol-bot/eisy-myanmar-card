/**
 * Dedicated Instant vs Standard component files + Noon toggle shell.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testComponentFilesExist() {
  section('Instant + Standard component files exist and stay isolated');
  const instant = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/instantCardView.js'),
    'utf8'
  );
  const standard = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/standardCardView.js'),
    'utf8'
  );
  const switcher = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/cardProviderSwitch.js'),
    'utf8'
  );

  assert.ok(instant.includes('instantCardView'));
  assert.ok(instant.includes('id="kripicardRequestForm"') || instant.includes('kripicardRequestForm'));
  assert.ok(instant.includes('instantMasterBalance'));
  assert.ok(instant.includes('Master Wallet'));
  assert.ok(!/bitnob/i.test(instant), 'Instant component must not mention Bitnob');
  assert.ok(!instant.includes('id="cardRequestForm"'), 'Instant must not embed Standard form id');
  assert.ok(!instant.includes('standardDepositAddress'));

  assert.ok(standard.includes('standardCardView'));
  assert.ok(standard.includes('id="cardRequestForm"') || standard.includes('cardRequestForm'));
  assert.ok(standard.includes('standardDepositAddress'));
  assert.ok(standard.includes('bitnob'));
  assert.ok(!/kripicard/i.test(standard), 'Standard component must not mention Kripicard');
  assert.ok(!standard.includes('id="kripicardRequestForm"'));
  assert.ok(!standard.includes('instantMasterBalance'));

  assert.ok(switcher.includes('cardProviderSwitch'));
  assert.ok(switcher.includes('instantCardView'));
  assert.ok(switcher.includes('standardCardView'));
  assert.ok(switcher.includes('card-provider-switch-footer'));
  console.log('ok');
}

function testServiceApisIsolated() {
  section('Instant + Standard API service modules are isolated');
  const instantApi = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/services/instantCardApi.js'),
    'utf8'
  );
  const standardApi = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/services/standardCardApi.js'),
    'utf8'
  );

  assert.ok(instantApi.includes('pricing-kripicard'));
  assert.ok(instantApi.includes('request-instant'));
  assert.ok(instantApi.includes('/card/bins'));
  assert.ok(!/bitnob/i.test(instantApi));
  assert.ok(!instantApi.includes('request-standard'));

  assert.ok(standardApi.includes('request-standard'));
  assert.ok(standardApi.includes('deposit-address'));
  assert.ok(standardApi.includes('card-funding'));
  assert.ok(!/kripicard/i.test(standardApi));
  assert.ok(!standardApi.includes('request-instant'));
  console.log('ok');
}

function testHtmlHostsAndNoonSwitch() {
  section('HTML hosts Noon switch shell + dedicated page hosts');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('id="cardProviderSwitchShell"'));
  assert.ok(html.includes('id="instantCardPageHost"'));
  assert.ok(html.includes('id="standardCardPageHost"'));
  assert.ok(html.includes('card-apply-panel'));
  assert.ok(html.includes('instantCardView.js'));
  assert.ok(html.includes('standardCardView.js'));
  assert.ok(html.includes('cardProviderSwitch.js'));
  assert.ok(html.includes('instantCardApi.js'));
  assert.ok(html.includes('standardCardApi.js'));
  // Markup lives in component files, not duplicated inline on cards page.
  assert.ok(!html.includes('id="kripicardRequestForm"'));
  assert.ok(!html.includes('id="cardRequestForm"'));
  assert.ok(!html.includes('id="cardProviderSwitch"'));
  console.log('ok');
}

function testDashboardWiresComponents() {
  section('dashboard mounts Noon switch / dedicated component modes');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('mountCardProviderUi'));
  assert.ok(dash.includes("mountCardProviderUi('switch')"));
  assert.ok(dash.includes("mountCardProviderUi('instant')"));
  assert.ok(dash.includes("mountCardProviderUi('standard')"));
  assert.ok(dash.includes('setCardProviderTab'));
  assert.ok(dash.includes('cardProviderSwitch'));
  assert.ok(dash.includes('instantCardView'));
  assert.ok(dash.includes('standardCardView'));
  console.log('ok');
}

function testRouteModulesIsolated() {
  section('API route modules remain provider-isolated');
  const instant = fs.readFileSync(path.join(ROOT, 'backend/src/routes/instantCard.js'), 'utf8');
  const standard = fs.readFileSync(path.join(ROOT, 'backend/src/routes/standardCard.js'), 'utf8');
  const user = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');

  assert.ok(instant.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(!instant.includes('purchaseCardFromUsdtWallet'));
  assert.ok(!instant.includes('bitnobWalletService'));

  assert.ok(standard.includes('purchaseCardFromUsdtWallet'));
  assert.ok(!standard.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(!standard.includes('kripicardCardWalletService'));

  assert.ok(user.includes("require('./instantCard')"));
  assert.ok(user.includes("require('./standardCard')"));
  console.log('ok');
}

function main() {
  testComponentFilesExist();
  testServiceApisIsolated();
  testHtmlHostsAndNoonSwitch();
  testDashboardWiresComponents();
  testRouteModulesIsolated();
  console.log('\nDedicated Instant/Standard component checks passed.');
}

main();
