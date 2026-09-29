/**
 * Admin Kripicard live balance widget + API route + auth/parsing guards.
 * Run: node backend/scripts/test-admin-kripicard-balance.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function testLibBalanceHelper() {
  section('lib/kripicard exposes fetchAccountBalance + USD parser');
  const lib = require(path.join(ROOT, 'lib/kripicard.js'));
  assert.equal(typeof lib.fetchAccountBalance, 'function');
  assert.equal(typeof lib.pickUsdBalance, 'function');
  assert.ok(lib.DEFAULT_BALANCE_URL.includes('/account/balance'));
  assert.equal(lib.pickUsdBalance({ balance_usd: 42.5 }), 42.5);
  assert.equal(lib.pickUsdBalance({ data: { available_balance: '19.00' } }), 19);
  assert.equal(lib.pickUsdBalance({ account: { wallet: { usd: 7 } } }), 7);
  assert.equal(lib.pickUsdBalance({ data: { account_balance: '3.5' } }), 3.5);
  assert.equal(lib.pickUsdBalance(undefined), null);
  assert.equal(lib.pickUsdBalance(null), null);
  assert.equal(lib.pickUsdBalance({}), null);
  assert.equal(lib.pickUsdBalance({ cards: [{ balance: 9 }] }), null);
  console.log('ok');
}

function testAuthStrategyMatchesProvider() {
  section('balance fetch uses api_key query/body (not headers alone)');
  const src = read('lib/kripicard.js');
  assert.ok(src.includes("url.searchParams.set('api_key', apiKey)"));
  assert.ok(src.includes("body: { api_key: apiKey }"));
  assert.ok(src.includes("authMode = 'get_query_api_key'"));
  assert.ok(src.includes("authMode = 'post_body_api_key'"));
  assert.ok(src.includes('KRIPICARD_BALANCE_MOCK_USD'));
  assert.ok(src.includes('[kripicard/balance]'));
  assert.ok(src.includes('KRIPICARD_UNAUTHORIZED') || src.includes("status === 401"));
  console.log('ok');
}

async function testMockMode() {
  section('KRIPICARD_BALANCE_MOCK_USD short-circuits live call');
  const prev = process.env.KRIPICARD_BALANCE_MOCK_USD;
  process.env.KRIPICARD_BALANCE_MOCK_USD = '1284.5';
  try {
    // Fresh require is not needed — function reads env at call time.
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard.js'))];
    const lib = require(path.join(ROOT, 'lib/kripicard.js'));
    const info = await lib.fetchAccountBalance();
    assert.equal(info.balance_usd, 1284.5);
    assert.equal(info.source, 'kripicard_mock');
    assert.equal(info.currency, 'USD');
  } finally {
    if (prev == null) delete process.env.KRIPICARD_BALANCE_MOCK_USD;
    else process.env.KRIPICARD_BALANCE_MOCK_USD = prev;
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard.js'))];
  }
  console.log('ok');
}

function testAdminRoute() {
  section('admin route GET /kripicard-balance');
  const admin = read('backend/src/routes/admin.js');
  assert.ok(admin.includes("router.get('/kripicard-balance'"));
  assert.ok(admin.includes("requirePermission('cards')"));
  assert.ok(admin.includes('fetchAccountBalance'));
  assert.ok(admin.includes('provider_status'));
  assert.ok(admin.includes('body_preview'));
  assert.ok(admin.includes('KRIPICARD_BALANCE_DEBUG') || admin.includes('debug'));
  assert.ok(!/bitnob/i.test(admin.match(/kripicard-balance[\s\S]{0,1200}/)?.[0] || ''));
  console.log('ok');
}

function testAdminUiWidget() {
  section('admin Overview widget for Kripicard balance');
  const html = read('backend/public/admin.html');
  assert.ok(html.includes('id="overviewKripicardBalanceCard"'));
  assert.ok(html.includes('id="kripicardBalanceStatus"'));
  assert.ok(html.includes('id="btnRefreshKripicardBalance"'));
  assert.ok(html.includes('data-kripicard-balance-refresh'));
  assert.ok(html.includes('Kripicard balance'));
  assert.ok(!/bitnob/i.test(html.match(/overviewKripicardBalanceCard[\s\S]{0,900}/)?.[0] || ''));

  const js = read('backend/public/admin.js');
  assert.ok(js.includes('checkKripicardBalance'));
  assert.ok(js.includes('renderKripicardBalance'));
  assert.ok(js.includes("fetch('/api/admin/kripicard-balance'"));
  assert.ok(js.includes('this.headers()'));
  assert.ok(js.includes('Fetching Kripicard balance'));
  assert.ok(js.includes('Could not load Kripicard balance'));
  assert.ok(js.includes('btn-spinner'));
  console.log('ok');
}

function testGeneratedShells() {
  section('Instant admin shell includes Kripicard balance card');
  require(path.join(ROOT, 'backend/scripts/write-admin-portal-html.js'));
  const instant = read('backend/public/admin-instant.html');
  assert.ok(instant.includes('overviewKripicardBalanceCard'));
  assert.ok(instant.includes('admin.js?v=20260929kripicardBalance'));
  console.log('ok');
}

async function main() {
  testLibBalanceHelper();
  testAuthStrategyMatchesProvider();
  await testMockMode();
  testAdminRoute();
  testAdminUiWidget();
  testGeneratedShells();
  console.log('\nAdmin Kripicard balance checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
