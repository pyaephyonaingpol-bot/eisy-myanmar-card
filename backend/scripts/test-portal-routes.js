/**
 * Instant portal routes (Kripicard + Master Wallet).
 * Legacy /business and /standard redirect to /instant.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testServerRoutesPortalPages() {
  section('Express serves /instant; legacy /business routes redirect');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(indexJs.includes("'/instant'") || indexJs.includes('"/instant"'));
  assert.ok(indexJs.includes('sendPortalApp') || indexJs.includes('__EISY_PORTAL__'));
  assert.ok(indexJs.includes('instant.html') || indexJs.includes("portal === 'instant'"));
  // Soft redirects for old Business bookmarks
  assert.ok(indexJs.includes("'/business'") || indexJs.includes('"/business"'));
  assert.ok(/redirect\(\s*302\s*,\s*['"]\/instant['"]\s*\)/.test(indexJs));
  assert.ok(!/sendPortalApp\(\s*res,\s*['"]standard['"]\s*\)/.test(indexJs), 'must not serve standard portal');
  assert.ok(!/Bitnob/i.test(indexJs), 'index.js must not mention Bitnob');
  console.log('ok');
}

function testPortalHtmlGenerator() {
  section('portal HTML generator is Instant-only');
  const writer = fs.readFileSync(path.join(ROOT, 'backend/scripts/write-portal-html.js'), 'utf8');
  assert.ok(writer.includes("writePortal('instant'") || writer.includes('instant'));
  assert.ok(!writer.includes("writePortal('standard'"), 'must not generate standard portal');
  require(path.join(ROOT, 'backend/scripts/write-portal-html.js'));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/public/instant.html')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'backend/public/standard.html')));
  const instant = fs.readFileSync(path.join(ROOT, 'backend/public/instant.html'), 'utf8');
  assert.ok(instant.includes('__EISY_PORTAL__="instant"') || instant.includes("__EISY_PORTAL__='instant'"));
  assert.ok(!/bitnob/i.test(instant));
  assert.ok(!/standardAppView|standardCardView|standardCardApi/i.test(instant));
  console.log('ok');
}

function testDashboardInstantOnly() {
  section('dashboard Instant-only (Instant-only hub)');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('/instant'));
  assert.ok(!/balance_bitnob|bitnob_customer|standardAppBitnob/i.test(dash));
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(!/standardCardApi|standardAppView|cardProviderSwitch/i.test(html));
  assert.ok(!/id="standard-card"|id="standardCardPage"/i.test(html));
  console.log('ok');
}

function testHubServiceCategories() {
  section('Hub catalog is retired; customer app uses TRON HD deposits');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(!dash.includes('/api/kripicard/services/purchase'), 'purchase API removed from dashboard');
  assert.ok(dash.includes('/api/tron/wallet/address'), 'TRON HD address loader');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(!indexJs.includes("app.use('/api/kripicard/services'"), 'hub routes unmounted');
  const hubApi = fs.readFileSync(path.join(ROOT, 'lib/kripicardHubApi.js'), 'utf8');
  assert.ok(hubApi.includes("'/services'") || hubApi.includes('/services'));
  assert.ok(hubApi.includes('mapMainServicesToHubCategories'));
  assert.ok(hubApi.includes('fetchModuleCatalog'));
  assert.ok(hubApi.includes('/esim/packages') && hubApi.includes('/gifts/packages'));
  assert.ok(dash.includes("category.id === 'esim'") && dash.includes("category.id === 'gift_cards'"));
  const css = fs.readFileSync(path.join(ROOT, 'backend/public/styles.css'), 'utf8');
  assert.ok(css.includes('hub-service-modal-box'));
  console.log('ok');
}

function main() {
  testServerRoutesPortalPages();
  testPortalHtmlGenerator();
  testDashboardInstantOnly();
  testHubServiceCategories();
  console.log('\nPortal route checks passed.');
}

main();
