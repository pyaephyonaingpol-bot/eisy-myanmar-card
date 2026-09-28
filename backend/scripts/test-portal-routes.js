/**
 * Dedicated Instant (/instant) and Standard (/standard) portal routes.
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
  section('Express serves /instant and /standard portal pages');
  const indexJs = fs.readFileSync(path.join(ROOT, 'backend/src/index.js'), 'utf8');
  assert.ok(indexJs.includes("'/instant'") || indexJs.includes('"/instant"'));
  assert.ok(indexJs.includes("'/standard'") || indexJs.includes('"/standard"'));
  assert.ok(indexJs.includes('sendPortalApp') || indexJs.includes('__EISY_PORTAL__'));
  assert.ok(indexJs.includes('instant.html') || indexJs.includes("portal === 'instant'"));
  console.log('ok');
}

function testPortalHtmlGenerator() {
  section('portal HTML generator + shells exist or are creatable');
  const writer = fs.readFileSync(path.join(ROOT, 'backend/scripts/write-portal-html.js'), 'utf8');
  assert.ok(writer.includes("writePortal('instant'"));
  assert.ok(writer.includes("writePortal('standard'"));
  // Ensure generated files exist for static/Vercel copy
  require(path.join(ROOT, 'backend/scripts/write-portal-html.js'));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/public/instant.html')));
  assert.ok(fs.existsSync(path.join(ROOT, 'backend/public/standard.html')));
  const instant = fs.readFileSync(path.join(ROOT, 'backend/public/instant.html'), 'utf8');
  const standard = fs.readFileSync(path.join(ROOT, 'backend/public/standard.html'), 'utf8');
  assert.ok(instant.includes("__EISY_PORTAL__=\"instant\"") || instant.includes("__EISY_PORTAL__='instant'"));
  assert.ok(standard.includes("__EISY_PORTAL__=\"standard\"") || standard.includes("__EISY_PORTAL__='standard'"));
  assert.ok(instant.includes('data-eisy-portal="instant"'));
  assert.ok(standard.includes('data-eisy-portal="standard"'));
  assert.ok(instant.includes('instantAppView.js'));
  assert.ok(standard.includes('standardAppView.js'));
  console.log('ok');
}

function testDashboardLocksPortal() {
  section('dashboard isolates portal DOMs and links between portals');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('getPortal'));
  assert.ok(dash.includes('applyPortalIsolation'));
  assert.ok(dash.includes('portalDefaultPage'));
  assert.ok(dash.includes('renderPortalHubChooser'));
  assert.ok(dash.includes('portal-switch-link'));
  assert.ok(dash.includes('.remove()'));
  assert.ok(dash.includes("window.location.href = '/instant'") || dash.includes('`/${mode}`'));
  assert.ok(dash.includes('standardPortalBlockedPages'));
  assert.ok(dash.includes('isStandardPortalBlockedPage'));
  assert.ok(dash.includes("data-instant-only"));
  assert.ok(dash.includes("'p2p'"));
  assert.ok(dash.includes('p2pBuyModal'));
  assert.ok(dash.includes('usdtTopUpModal'));
  console.log('ok');
}

function testStandardPortalStripsInstantModules() {
  section('Standard portal HTML marks Instant-only modules for removal');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('data-instant-only'));
  assert.ok(/data-page="p2p"[^>]*data-instant-only|data-instant-only[^>]*data-page="p2p"/.test(html));
  assert.ok(/data-page="usdt-wallet"[^>]*data-instant-only|data-instant-only[^>]*data-page="usdt-wallet"/.test(html));
  assert.ok(/data-page="deposits"[^>]*data-instant-only|data-instant-only[^>]*data-page="deposits"/.test(html));
  assert.ok(html.includes('id="p2pBuyModal"') && html.includes('data-instant-only'));
  assert.ok(html.includes('id="usdtTopUpModal"'));
  assert.ok(html.includes('id="settingsKycHint"'));
  assert.ok(!/Required to post P2P ads and trade on the marketplace/.test(html));
  console.log('ok');
}

function testViewsStayIsolated() {
  section('Instant/Standard app views remain provider-isolated');
  const instant = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/instantAppView.js'),
    'utf8'
  );
  const standard = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/standardAppView.js'),
    'utf8'
  );
  assert.ok(!/bitnob/i.test(instant));
  assert.ok(!/kripicard/i.test(standard));
  assert.ok(instant.includes('instantAppTrc20Address') || instant.includes('USDT'));
  assert.ok(standard.includes('standardAppBitnobBalance') || standard.includes('Bitnob'));
  console.log('ok');
}

function main() {
  testServerRoutesPortalPages();
  testPortalHtmlGenerator();
  testDashboardLocksPortal();
  testStandardPortalStripsInstantModules();
  testViewsStayIsolated();
  console.log('\nPortal route checks passed.');
}

main();
