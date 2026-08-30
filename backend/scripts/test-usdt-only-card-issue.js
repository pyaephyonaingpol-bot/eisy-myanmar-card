#!/usr/bin/env node
/**
 * Tests for USDT-only automated card issuance (no MMK / KBZ / Wave on purchase).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testUiUsdtOnly() {
  section('Apply Card UI is USDT-only');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  const i18n = fs.readFileSync(path.join(ROOT, 'backend/public/i18n.js'), 'utf8');

  const formStart = html.indexOf('id="cardRequestForm"');
  const formEnd = html.indexOf('id="cardRequestReceipt"');
  assert.ok(formStart >= 0 && formEnd > formStart, 'card request form markers');
  const formHtml = html.slice(formStart, formEnd);

  assert.ok(formHtml.includes('wallet_usdt'), 'USDT option present');
  assert.ok(!formHtml.includes('wallet_mmk'), 'MMK wallet option removed from apply form');
  assert.ok(formHtml.includes('cardHolderNameInput'), 'name on card field');
  assert.ok(formHtml.includes('cardBinSelect'), 'BIN select');
  assert.ok(formHtml.includes('539502'), 'default BIN seeded in HTML');
  assert.ok(formHtml.includes('525847'), 'second BIN seeded in HTML');
  assert.ok(formHtml.includes('441357'), 'third BIN seeded in HTML');
  assert.ok(!formHtml.includes('Loading BINs'), 'no loading placeholder');
  assert.ok(!formHtml.includes('id="pbMmkRow"'), 'MMK pricing row removed from apply form');
  assert.ok(formHtml.includes('id="pbUsdtRow"'), 'USDT pricing row present');

  assert.ok(dash.includes('FALLBACK_BINS'), 'client fallback BIN list');
  assert.ok(dash.includes('populateCardBinOptions'), 'BIN population helper');
  assert.ok(dash.includes("wallet_type: 'usdt'"), 'submit forces usdt');
  assert.ok(!dash.includes("pay_from_wallet && walletType === 'mmk'"), 'no MMK wallet branch in submit');
  const cardPayFn = dash.slice(
    dash.indexOf('populateCardPaymentMethodOptions() {'),
    dash.indexOf('populateCardBinOptions() {')
  );
  assert.ok(cardPayFn.includes('wallet_usdt'), 'card pay options include USDT');
  assert.ok(!cardPayFn.includes('wallet_mmk'), 'card pay options exclude MMK');
  assert.ok(!cardPayFn.includes('bankOpts'), 'card pay options exclude bank/KBZ/Wave');
  assert.ok(i18n.includes('Issue Card Instantly') || i18n.includes('instant issue'));
  assert.ok(i18n.includes('Kripicard'));
  console.log('ok');
}

function testBackendUsdtOnly() {
  section('Backend rejects MMK / manual card issuance');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const wallet = fs.readFileSync(path.join(ROOT, 'backend/src/services/cardWalletService.js'), 'utf8');

  assert.ok(route.includes('USDT_ONLY_CARD_ISSUANCE'));
  assert.ok(route.includes('purchaseCardFromUsdtWallet'));
  assert.ok(route.includes('kripicard_default_bin'));
  assert.ok(!route.includes("walletType === 'mmk'"), 'card/request no longer branches on mmk');
  // Manual KBZ path removed from card/request (purpose card_issuance deposit create)
  const requestIdx = route.indexOf("router.post('/card/request'");
  const reloadIdx = route.indexOf("router.post('/card/reload'");
  assert.ok(requestIdx >= 0 && reloadIdx > requestIdx);
  const requestBlock = route.slice(requestIdx, reloadIdx);
  assert.ok(!requestBlock.includes('createDepositRequest'), 'no MMK deposit creation in card/request');
  assert.ok(!requestBlock.includes('calculateCardRequestPricing('), 'no MMK FX pricing in card/request');
  assert.ok(requestBlock.includes('name_on_card') || requestBlock.includes('card_holder_name'));

  assert.ok(wallet.includes('issueCardForUser'));
  assert.ok(wallet.includes('MMK_CARD_ISSUANCE_DISABLED'));
  assert.ok(wallet.includes('creditUsdt'), 'refunds on provider failure');
  assert.ok(wallet.includes('CARD_ISSUED_MESSAGE'));
  console.log('ok');
}

async function testPurchaseCardFromWalletThrows() {
  section('purchaseCardFromWallet throws MMK_CARD_ISSUANCE_DISABLED');
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
  const { purchaseCardFromWallet, resolveKripicardBin, getKripicardBinOptions } = require(
    path.join(ROOT, 'backend/src/services/cardWalletService')
  );

  let err = null;
  try {
    await purchaseCardFromWallet(1, { initialLoadUsd: 10 });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'MMK_CARD_ISSUANCE_DISABLED');

  process.env.KRIPICARD_DEFAULT_BIN = '428803';
  process.env.KRIPICARD_ALLOWED_BINS = '428803,411111';
  assert.strictEqual(resolveKripicardBin(), '428803');
  assert.strictEqual(resolveKripicardBin('411111'), '411111');
  let binErr = null;
  try {
    resolveKripicardBin('999999');
  } catch (e) {
    binErr = e;
  }
  assert.ok(binErr);
  assert.strictEqual(binErr.code, 'INVALID_BIN');
  const opts = getKripicardBinOptions();
  assert.deepStrictEqual(opts.bins, ['428803', '411111']);

  // Without env allow-list, built-in catalog is returned (not empty).
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
  const refreshed = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
  const catalog = refreshed.getKripicardBinOptions();
  assert.ok(catalog.bins.length >= 3, 'default BIN catalog must be non-empty');
  assert.ok(catalog.bins.includes('539502'));
  assert.ok(catalog.bins.includes('525847'));
  assert.ok(catalog.bins.includes('441357'));
  assert.strictEqual(catalog.source, 'default_catalog');
  console.log('ok');
}

async function main() {
  testUiUsdtOnly();
  testBackendUsdtOnly();
  await testPurchaseCardFromWalletThrows();
  console.log('\nAll USDT-only card issuance tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
