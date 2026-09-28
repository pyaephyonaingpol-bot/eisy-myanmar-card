/**
 * Standard portal must expose Bitnob + KYC + Standard Card only —
 * no P2P Express, Master USDT wallet, Scan Pay, or Instant deposit chrome.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testIsolationSource() {
  section('dashboard Standard cleanup source guards');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('standardPortalBlockedPages'));
  assert.ok(dash.includes('isStandardPortalBlockedPage'));
  assert.ok(dash.includes('[data-instant-only]'));
  assert.ok(dash.includes("'p2pBuyModal'"));
  assert.ok(dash.includes("'usdtTopUpModal'"));
  assert.ok(dash.includes("'scanPayModal'"));
  assert.ok(dash.includes("'withdrawUsdtModal'"));
  assert.ok(dash.includes("'sellUsdtMmkModal'"));
  assert.ok(dash.includes("'pageP2p'"));
  assert.ok(dash.includes("'pageDeposits'"));
  assert.ok(
    dash.includes("Master USDT top-up is only available in the Instant portal")
      || dash.includes('_portal === \'standard\'')
  );
  console.log('ok');
}

function testHtmlMarksInstantOnly() {
  section('index.html marks Instant-only modules for Standard removal');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');

  assert.ok(/data-page="p2p"[^>]*data-instant-only|data-instant-only[^>]*data-page="p2p"/.test(html));
  assert.ok(
    /data-page="usdt-wallet"[^>]*data-instant-only|data-instant-only[^>]*data-page="usdt-wallet"/.test(html)
  );
  assert.ok(
    /data-page="deposits"[^>]*data-instant-only|data-instant-only[^>]*data-page="deposits"/.test(html)
  );

  for (const id of [
    'usdtTopUpModal',
    'scanPayModal',
    'withdrawUsdtModal',
    'withdrawMmkModal',
    'sellUsdtMmkModal',
    'p2pBuyModal',
    'p2pSellModal',
    'p2pPostAdModal',
  ]) {
    const re = new RegExp(`id="${id}"[^>]*data-instant-only|data-instant-only[^>]*id="${id}"`);
    assert.ok(re.test(html), `${id} must be marked data-instant-only`);
  }

  assert.ok(html.includes('id="walletHeroBitnob"'));
  assert.ok(html.includes('id="standardAppPageHost"'));
  assert.ok(html.includes('id="settingsKycHint"'));
  assert.ok(!/Required to post P2P ads and trade on the marketplace/.test(html));
  assert.ok(/Standard Card \/ Bitnob wallet|Bitnob wallet \(verified/.test(html));
  console.log('ok');
}

function testStandardAppViewStaysBitnobOnly() {
  section('standardAppView stays Bitnob/KYC focused');
  const standard = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/standardAppView.js'),
    'utf8'
  );
  assert.ok(standard.includes('Bitnob'));
  assert.ok(standard.includes('standardAppVerifyStatus'));
  assert.ok(!/p2p/i.test(standard));
  assert.ok(!standard.includes('data-open-usdt-topup'));
  assert.ok(!standard.includes('Scan Pay'));
  assert.ok(!/kripicard/i.test(standard));
  console.log('ok');
}

function testBlockedPagesList() {
  section('Standard portal blocked page list covers Instant modules');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  const match = dash.match(/standardPortalBlockedPages\(\)\s*\{[\s\S]*?return new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(match, 'standardPortalBlockedPages Set must exist');
  const body = match[1];
  for (const page of ['instant-card', 'usdt-wallet', 'p2p', 'deposits']) {
    assert.ok(body.includes(`'${page}'`), `blocked pages must include ${page}`);
  }
  console.log('ok');
}

function main() {
  testIsolationSource();
  testHtmlMarksInstantOnly();
  testStandardAppViewStaysBitnobOnly();
  testBlockedPagesList();
  console.log('\nStandard portal cleanup checks passed.');
}

main();
