/**
 * Dual-wallet architecture smoke tests:
 *   Instant  → Master Wallet ledger (balance_usdt) → Kripicard
 *   Standard → Bitnob ledger (balance_bitnob_usdt) → Bitnob
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testModulesExist() {
  section('dual-wallet modules present');
  const files = [
    'backend/src/services/bitnobWalletLedgerService.js',
    'backend/src/services/bitnobWalletService.js',
    'backend/src/services/cardWalletService.js',
    'backend/src/services/kripicardCardWalletService.js',
    'backend/migrations/061_dual_wallet_bitnob_ledger.sql',
    'lib/bitnob.js',
  ];
  for (const rel of files) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
  }
  console.log('ok');
}

function testBitnobClientExports() {
  section('bitnob client exports deposit + balances');
  const bitnob = require(path.join(ROOT, 'lib/bitnob'));
  assert.equal(typeof bitnob.generateDepositAddress, 'function');
  assert.equal(typeof bitnob.getBalances, 'function');
  assert.equal(typeof bitnob.getBalanceByCurrency, 'function');
  assert.equal(typeof bitnob.createVirtualCard, 'function');
  assert.equal(typeof bitnob.fundCard, 'function');
  console.log('ok');
}

function testLedgerSeparationInServices() {
  section('services keep ledgers separate');
  const cardWallet = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/cardWalletService.js'),
    'utf8'
  );
  assert.ok(cardWallet.includes('debitBitnobUsdt'));
  assert.ok(cardWallet.includes("wallet: 'bitnob_usdt'") || cardWallet.includes('bitnob_usdt'));
  assert.ok(cardWallet.includes("ledger: 'bitnob'"));
  // Standard purchase must not debit Master Wallet available balance helpers for issue.
  const purchaseFn = cardWallet.slice(
    cardWallet.indexOf('async function purchaseCardFromUsdtWallet'),
    cardWallet.indexOf('async function reloadCardFromUsdtWallet')
  );
  assert.ok(purchaseFn.includes('debitBitnobUsdt'));
  assert.ok(!purchaseFn.includes('debitUsdt('), 'Standard purchase must not debit Master Wallet');

  const kripi = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/kripicardCardWalletService.js'),
    'utf8'
  );
  assert.ok(kripi.includes('debitUsdt') || kripi.includes('debitUsdtForCardPurchase'));
  assert.ok(kripi.includes("provider: 'kripicard'"));

  const ledgerSvc = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/bitnobWalletLedgerService.js'),
    'utf8'
  );
  assert.ok(ledgerSvc.includes('balance_bitnob_usdt'));
  assert.ok(ledgerSvc.includes('INSUFFICIENT_BITNOB_BALANCE'));
  console.log('ok');
}

function testRoutesExposeDualWallets() {
  section('user routes expose dual wallet APIs');
  const src = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  assert.ok(src.includes("/wallets/card-funding"));
  assert.ok(src.includes("/wallets/standard/deposit-address"));
  assert.ok(src.includes("/card/request-instant"));
  assert.ok(src.includes("/card/request-standard"));
  assert.ok(src.includes('getDualWalletOverview'));
  assert.ok(src.includes('getOrCreateStandardDepositAddress'));
  assert.ok(src.includes('INSUFFICIENT_BITNOB_BALANCE'));
  assert.ok(src.includes('Master Wallet'));

  const webhook = fs.readFileSync(path.join(ROOT, 'backend/src/routes/webhook.js'), 'utf8');
  assert.ok(webhook.includes("/bitnob/deposits"));
  assert.ok(webhook.includes('creditStandardWalletFromDeposit'));
  console.log('ok');
}

function testUiLabelsAndDepositPanels() {
  section('UI has Instant/Standard switch + dual deposit panels');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('pill_instant_card'));
  assert.ok(html.includes('pill_standard_card'));
  assert.ok(html.includes('standardDepositAddress'));
  assert.ok(html.includes('instantMasterBalance'));
  assert.ok(html.includes('pay_master_wallet_issuance'));
  assert.ok(html.includes('pay_standard_wallet_issuance'));
  assert.ok(!/Kripicard|Bitnob/.test(
    [...html.matchAll(/card-provider-tab-title[^>]*>([^<]*)</g)].map((m) => m[1]).join(' ')
  ));

  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('loadCardFundingWallets'));
  assert.ok(dash.includes('loadStandardDepositAddress'));
  assert.ok(dash.includes('/api/user/card/request-standard'));
  assert.ok(dash.includes('wallet_type: \'bitnob_usdt\''));
  console.log('ok');
}

function testMigration() {
  section('migration adds bitnob ledger columns');
  const sql = fs.readFileSync(
    path.join(ROOT, 'backend/migrations/061_dual_wallet_bitnob_ledger.sql'),
    'utf8'
  );
  assert.ok(sql.includes('balance_bitnob_usdt'));
  assert.ok(sql.includes('bitnob_deposit_address'));
  assert.ok(sql.includes('bitnob_wallet_ledger'));
  assert.ok(sql.includes('bitnob_deposit_events'));
  console.log('ok');
}

function main() {
  testModulesExist();
  testBitnobClientExports();
  testLedgerSeparationInServices();
  testRoutesExposeDualWallets();
  testUiLabelsAndDepositPanels();
  testMigration();
  console.log('\nDual-wallet architecture checks passed.');
}

main();
