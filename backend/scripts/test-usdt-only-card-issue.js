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

  assert.ok(formHtml.includes('wallet_usdt'), 'USDT payment value present');
  assert.ok(formHtml.includes('cardPayFromUsdt'), 'static USDT pay-from label');
  assert.ok(formHtml.includes('type="hidden" id="cardPaymentMethod"'), 'hidden USDT payment field (no dropdown)');
  assert.ok(!/<select[^>]*id="cardPaymentMethod"/.test(formHtml), 'no cardPaymentMethod dropdown');
  assert.ok(!formHtml.includes('wallet_mmk'), 'MMK wallet option removed from apply form');
  assert.ok(!formHtml.includes('KBZPay') && !formHtml.includes('WavePay'), 'no KBZ/Wave options in apply form');
  assert.ok(!formHtml.includes('cardPaymentMethodDetails'), 'no manual bank QR details block');
  assert.ok(formHtml.includes('cardHolderNameInput'), 'name on card field');
  assert.ok(formHtml.includes('cardBinSelect'), 'BIN select');
  assert.ok(formHtml.includes('Loading available BINs'), 'loading placeholder while live BINs fetch');
  assert.ok(!formHtml.includes('539502'), 'outdated BIN 539502 must not be hardcoded');
  assert.ok(!formHtml.includes('525847'), 'outdated BIN 525847 must not be hardcoded');
  assert.ok(!formHtml.includes('441357'), 'outdated BIN 441357 must not be hardcoded');
  assert.ok(!formHtml.includes('id="pbMmkRow"'), 'MMK pricing row removed from apply form');
  assert.ok(formHtml.includes('id="pbUsdtRow"'), 'USDT pricing row present');
  assert.ok(formHtml.includes('usdt_parity_rate') || formHtml.includes('1 USDT'), 'USDT parity rate label');

  assert.ok(!dash.includes('FALLBACK_BINS'), 'no hardcoded client FALLBACK_BINS');
  assert.ok(!dash.includes('539502'), 'dashboard must not hardcode outdated BINs');
  assert.ok(dash.includes('populateCardBinOptions'), 'BIN population helper');
  assert.ok(dash.includes('No active BINs available') || dash.includes('Loading available BINs'), 'empty/loading BIN UI states');
  assert.ok(dash.includes("wallet_type: 'usdt'"), 'submit forces usdt');
  assert.ok(!dash.includes("pay_from_wallet && walletType === 'mmk'"), 'no MMK wallet branch in submit');
  assert.ok(!dash.includes('populateDepositFromCardRequest'), 'orphan MMK deposit-from-card helper removed');
  const cardPayFn = dash.slice(
    dash.indexOf('populateCardPaymentMethodOptions() {'),
    dash.indexOf('populateCardBinOptions() {')
  );
  assert.ok(cardPayFn.includes('wallet_usdt'), 'card pay options include USDT');
  assert.ok(!cardPayFn.includes('wallet_mmk'), 'card pay options exclude MMK');
  assert.ok(!cardPayFn.includes('bankOpts'), 'card pay options exclude bank/KBZ/Wave');
  assert.ok(!cardPayFn.includes('<option'), 'no payment dropdown options built for card purchase');

  const pricingFn = dash.slice(
    dash.indexOf('updateCardPricingBreakdown() {'),
    dash.indexOf('formatPricingReceiptHtml(')
  );
  assert.ok(pricingFn.includes("payment_currency: 'USDT'"), 'pricing breakdown is USDT');
  assert.ok(pricingFn.includes('exchange_rate_applied: false'), 'no FX applied in card pricing UI');
  assert.ok(!pricingFn.includes('total_mmk') && !pricingFn.includes('pbTotalMmk'), 'no MMK total in card pricing UI');

  assert.ok(i18n.includes('usdt_parity_rate'), 'i18n has USDT parity rate');
  assert.ok(!i18n.includes('pay_mmk_wallet_issuance'), 'i18n MMK issuance option removed');
  assert.ok(!i18n.includes('card_wallet_ok_mmk'), 'dead MMK card-wallet i18n removed');
  assert.ok(i18n.includes('Issue Card Instantly') || i18n.includes('instant issue'));
  assert.ok(i18n.includes('Kripicard'));
  assert.ok(
    !html.includes('virtual card issuance and card reloads'),
    'HTML no longer claims MMK is for card issuance'
  );
  console.log('ok');
}

function testBackendUsdtOnly() {
  section('Backend rejects MMK / manual card issuance');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const wallet = fs.readFileSync(path.join(ROOT, 'backend/src/services/cardWalletService.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'backend/src/services/settingsService.js'), 'utf8');
  const walletSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/walletService.js'), 'utf8');
  const depositSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/depositService.js'), 'utf8');
  const cardIssue = fs.readFileSync(path.join(ROOT, 'lib/cardIssue.js'), 'utf8');

  assert.ok(route.includes('USDT_ONLY_CARD_ISSUANCE'));
  assert.ok(route.includes('purchaseCardFromUsdtWallet'));
  assert.ok(route.includes('kripicard_default_bin'));
  assert.ok(route.includes('card_issuance_rate'));
  assert.ok(route.includes('exchange_rate_applied: false'));
  assert.ok(!route.includes("walletType === 'mmk'"), 'card/request no longer branches on mmk');
  const requestIdx = route.indexOf("router.post('/card/request'");
  const reloadIdx = route.indexOf("router.post('/card/reload'");
  assert.ok(requestIdx >= 0 && reloadIdx > requestIdx);
  const requestBlock = route.slice(requestIdx, reloadIdx);
  assert.ok(!requestBlock.includes('createDepositRequest'), 'no MMK deposit creation in card/request');
  assert.ok(!requestBlock.includes('calculateCardRequestPricing('), 'no MMK FX pricing in card/request');
  assert.ok(!requestBlock.includes('payFromWallet'), 'no pay_from_wallet gate — always USDT issue');
  assert.ok(requestBlock.includes('name_on_card') || requestBlock.includes('card_holder_name'));

  assert.ok(wallet.includes('issueCardForUser'));
  assert.ok(!wallet.includes('purchaseCardFromWallet'), 'MMK purchaseCardFromWallet stub removed');
  assert.ok(wallet.includes('creditUsdt'), 'refunds on provider failure');
  assert.ok(wallet.includes('CARD_ISSUED_MESSAGE'));

  assert.ok(!settings.includes('function calculateCardRequestPricing('), 'MMK FX card pricing removed');
  assert.ok(settings.includes('function calculateCardRequestPricingUsdt('), 'USDT pricing retained');

  const allowList = walletSvc.slice(
    walletSvc.indexOf('MMK_WALLET_ALLOWED_DEBIT_PURPOSES'),
    walletSvc.indexOf('function assertMmkDebitAllowed')
  );
  assert.ok(!allowList.includes("'card_reload'"), 'MMK debit allow-list excludes card_reload');
  assert.ok(!allowList.includes("'card_issuance'"), 'MMK debit allow-list excludes card_issuance');
  assert.ok(walletSvc.includes("purpose === 'card_issuance'"), 'explicit reject of MMK card_issuance debit');

  assert.ok(depositSvc.includes("purpose === 'card_issuance'"), 'createDepositRequest blocks card_issuance');
  assert.ok(depositSvc.includes('USDT_ONLY_CARD_ISSUANCE'), 'deposit create rejects MMK issuance');

  assert.ok(cardIssue.includes('resolveIssuanceCurrency'), 'Next/lib rejects MMK currency');
  assert.ok(cardIssue.includes("value === 'MMK'"), 'MMK currency rejected in lib/cardIssue');
  console.log('ok');
}

async function testIssuanceHelpers() {
  section('Issuance helpers reject MMK and resolve BINs');
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/cardIssue'))];

  const { purchaseCardFromUsdtWallet } = require(
    path.join(ROOT, 'backend/src/services/cardWalletService')
  );
  const { resolveIssuanceCurrency } = require(path.join(ROOT, 'lib/cardIssue'));

  assert.strictEqual(typeof purchaseCardFromUsdtWallet, 'function');
  assert.strictEqual(resolveIssuanceCurrency('USDT'), 'USD');
  assert.strictEqual(resolveIssuanceCurrency('usd'), 'USD');
  let currencyErr = null;
  try {
    resolveIssuanceCurrency('MMK');
  } catch (e) {
    currencyErr = e;
  }
  assert.ok(currencyErr);
  assert.strictEqual(currencyErr.code, 'USDT_ONLY_CARD_ISSUANCE');

  process.env.KRIPICARD_API_KEY = 'test-kripicard-key';
  process.env.KRIPICARD_DEFAULT_BIN = '428803';
  process.env.KRIPICARD_ALLOWED_BINS = '428803,411111';

  // Env allow-list is used when the live Kripicard BIN API is unreachable.
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new Error('network down');
    err.code = 'KRIPICARD_NETWORK';
    throw err;
  };
  try {
    const {
      resolveKripicardBin: resolveBin,
      getKripicardBinOptions: getBins,
      resetKripicardBinCacheForTests,
    } = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    resetKripicardBinCacheForTests();

    assert.strictEqual(await resolveBin(), '428803');
    assert.strictEqual(await resolveBin('411111'), '411111');
    let binErr = null;
    try {
      await resolveBin('999999');
    } catch (e) {
      binErr = e;
    }
    assert.ok(binErr);
    assert.strictEqual(binErr.code, 'INVALID_BIN');
    const opts = await getBins({ forceRefresh: true });
    assert.deepStrictEqual(opts.bins, ['428803', '411111']);
    assert.ok(opts.source === 'env_fallback' || opts.source === 'env', opts.source);
  } finally {
    global.fetch = originalFetch;
  }

  // Live API path: only active BINs returned (maintenance filtered out).
  delete process.env.KRIPICARD_ALLOWED_BINS;
  delete process.env.KRIPICARD_DEFAULT_BIN;
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        bins: [
          { bin: '400011', status: 'active' },
          { bin: '539502', status: 'maintenance' },
          { bin: '400022', available: true },
        ],
      });
    },
  });
  try {
    const refreshed = require(path.join(ROOT, 'backend/src/services/cardWalletService'));
    refreshed.resetKripicardBinCacheForTests();
    const catalog = await refreshed.getKripicardBinOptions({ forceRefresh: true });
    assert.ok(catalog.bins.includes('400011'));
    assert.ok(catalog.bins.includes('400022'));
    assert.ok(!catalog.bins.includes('539502'), 'maintenance BIN filtered out');
    assert.strictEqual(catalog.source, 'kripicard_api');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testCreateDepositBlocksCardIssuance() {
  section('createDepositRequest rejects purpose=card_issuance');
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/depositService'))];
  const { createDepositRequest } = require(path.join(ROOT, 'backend/src/services/depositService'));

  let err = null;
  try {
    await createDepositRequest(1, {
      amount_mmk: 50000,
      payment_method: 'kbzpay',
      purpose: 'card_issuance',
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, 'USDT_ONLY_CARD_ISSUANCE');
  console.log('ok');
}

async function main() {
  testUiUsdtOnly();
  testBackendUsdtOnly();
  await testIssuanceHelpers();
  await testCreateDepositBlocksCardIssuance();
  console.log('\nAll USDT-only card issuance tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
