#!/usr/bin/env node
/**
 * Tests for USDT-only automated card issuance (no MMK / KBZ / Wave on purchase).
 * Provider: Bitnob (no BIN select).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testUiUsdtOnly() {
  section('Apply Card UI is USDT-only (Bitnob, no BIN)');
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
  assert.ok(!formHtml.includes('cardBinSelect'), 'BIN select removed');
  assert.ok(!formHtml.includes('Loading available BINs'), 'no BIN loading placeholder');
  assert.ok(!formHtml.includes('Kripicard'), 'no Kripicard copy in apply form');
  assert.ok(formHtml.includes('Bitnob') || html.includes('apply_new_card_hint'), 'Bitnob / i18n hint present');
  assert.ok(!formHtml.includes('id="pbMmkRow"'), 'MMK pricing row removed from apply form');
  assert.ok(formHtml.includes('id="pbUsdtRow"'), 'USDT pricing row present');
  assert.ok(formHtml.includes('usdt_parity_rate') || formHtml.includes('1 USDT'), 'USDT parity rate label');

  assert.ok(!dash.includes('FALLBACK_BINS'), 'no hardcoded client FALLBACK_BINS');
  assert.ok(!dash.includes('populateCardBinOptions'), 'BIN population helper removed');
  assert.ok(!dash.includes('getSelectedCardBin'), 'BIN getter removed');
  assert.ok(!dash.includes('kripicard_bins'), 'no kripicard_bins client refs');
  assert.ok(dash.includes("wallet_type: 'usdt'"), 'submit forces usdt');
  assert.ok(dash.includes('bitnob_customer_ready'), 'checks Bitnob customer readiness');
  assert.ok(!dash.includes("pay_from_wallet && walletType === 'mmk'"), 'no MMK wallet branch in submit');
  assert.ok(!dash.includes('populateDepositFromCardRequest'), 'orphan MMK deposit-from-card helper removed');
  const cardPayFn = dash.slice(
    dash.indexOf('populateCardPaymentMethodOptions() {'),
    dash.indexOf('populateReloadPaymentMethodOptions() {')
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
  assert.ok(!i18n.includes('card_bin'), 'card_bin i18n removed');
  assert.ok(!i18n.includes('Kripicard'), 'no Kripicard i18n strings');
  assert.ok(i18n.includes('Bitnob'), 'Bitnob i18n strings present');
  assert.ok(i18n.includes('Issue Card Instantly') || i18n.includes('instant issue'));
  assert.ok(
    !html.includes('virtual card issuance and card reloads'),
    'HTML no longer claims MMK is for card issuance'
  );
  console.log('ok');
}

function testBackendUsdtOnly() {
  section('Backend rejects MMK / uses Bitnob issuance');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const wallet = fs.readFileSync(path.join(ROOT, 'backend/src/services/cardWalletService.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'backend/src/services/settingsService.js'), 'utf8');
  const walletSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/walletService.js'), 'utf8');
  const depositSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/depositService.js'), 'utf8');
  const cardIssue = fs.readFileSync(path.join(ROOT, 'lib/cardIssue.js'), 'utf8');

  assert.ok(route.includes('USDT_ONLY_CARD_ISSUANCE'));
  assert.ok(route.includes('purchaseCardFromUsdtWallet'));
  assert.ok(route.includes('bitnob_customer_ready'));
  assert.ok(route.includes('provider: \'bitnob\'') || route.includes("provider: 'bitnob'"));
  assert.ok(route.includes('card_issuance_rate'));
  assert.ok(route.includes('exchange_rate_applied: false'));
  assert.ok(!route.includes('kripicard_default_bin'), 'kripicard bin pricing fields removed');
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
  assert.ok(wallet.includes('resolveBitnobCustomerId'));
  assert.ok(wallet.includes('assertBitnobConfigured'));
  assert.ok(!wallet.includes('purchaseCardFromWallet'), 'MMK purchaseCardFromWallet stub removed');
  assert.ok(!wallet.includes('getKripicardBinOptions'), 'Kripicard BIN helpers removed');
  assert.ok(wallet.includes('creditUsdt'), 'refunds on provider failure');
  assert.ok(wallet.includes('CARD_ISSUED_MESSAGE'));

  assert.ok(!settings.includes('function calculateCardRequestPricing('), 'MMK FX card pricing removed');
  assert.ok(settings.includes('function calculateCardRequestPricingUsdt('), 'USDT pricing retained');
  assert.ok(settings.includes('provider_load_usd'), 'pricing exposes provider_load_usd');
  assert.ok(settings.includes('Bitnob'), 'pricing note mentions Bitnob');

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
  assert.ok(cardIssue.includes('createAndPersistBitnobCard'), 'Bitnob issue helper exported');
  assert.ok(!cardIssue.includes('Kripicard') && !cardIssue.includes('kripicard'), 'lib/cardIssue has no Kripicard');
  console.log('ok');
}

async function testIssuanceHelpers() {
  section('Issuance helpers reject MMK and require Bitnob customer');
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/cardWalletService'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/cardIssue'))];

  const { purchaseCardFromUsdtWallet } = require(
    path.join(ROOT, 'backend/src/services/cardWalletService')
  );
  const {
    resolveIssuanceCurrency,
    resolveBitnobCustomerId,
    validateIssueInput,
  } = require(path.join(ROOT, 'lib/cardIssue'));

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

  const prevDefault = process.env.BITNOB_DEFAULT_CUSTOMER_ID;
  delete process.env.BITNOB_DEFAULT_CUSTOMER_ID;
  assert.strictEqual(resolveBitnobCustomerId({}), null);
  assert.strictEqual(resolveBitnobCustomerId({ customerId: 'cust_1' }), 'cust_1');
  assert.strictEqual(
    resolveBitnobCustomerId({ user: { bitnob_customer_id: 'cust_user' } }),
    'cust_user'
  );
  process.env.BITNOB_DEFAULT_CUSTOMER_ID = 'cust_env';
  assert.strictEqual(resolveBitnobCustomerId({}), 'cust_env');

  let validateErr = null;
  try {
    delete process.env.BITNOB_DEFAULT_CUSTOMER_ID;
    validateIssueInput({
      userId: '1',
      nameOnCard: 'Test User',
      amount: 10,
    });
  } catch (e) {
    validateErr = e;
  }
  assert.ok(validateErr);
  assert.strictEqual(validateErr.code, 'BITNOB_CUSTOMER_REQUIRED');

  if (prevDefault !== undefined) process.env.BITNOB_DEFAULT_CUSTOMER_ID = prevDefault;
  else delete process.env.BITNOB_DEFAULT_CUSTOMER_ID;

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
