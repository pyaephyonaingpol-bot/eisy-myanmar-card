#!/usr/bin/env node
/**
 * Dual-provider card issuance smoke tests (Kripicard Non-KYC + Bitnob KYC gating).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testModulesExist() {
  section('provider modules present');
  const files = [
    'lib/kripicard.js',
    'lib/kripicardCardIssue.js',
    'lib/bitnob.js',
    'lib/cardIssue.js',
    'backend/src/services/kripicardCardWalletService.js',
    'backend/src/services/kripicardCardIssueService.js',
    'backend/src/services/cardWalletService.js',
    'backend/src/services/bitnobService.js',
  ];
  for (const rel of files) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
  }
  console.log('ok');
}

function testPricingSideBySide() {
  section('pricing calculators are separate');
  const {
    calculateCardRequestPricingUsdt,
    calculateKripicardRequestPricingUsdt,
  } = require('../src/services/settingsService');

  const settings = {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
    card_funding_fee_percent: 0,
  };

  const bitnob = calculateCardRequestPricingUsdt(25, settings);
  assert.strictEqual(bitnob.provider, 'bitnob');
  assert.ok(bitnob.bitnob_create_fee_usd >= 2);
  assert.strictEqual(bitnob.mmk_wallet_allowed, false);

  const kripi = calculateKripicardRequestPricingUsdt(25, settings);
  assert.strictEqual(kripi.provider, 'kripicard');
  assert.strictEqual(kripi.kripicard_cost_usd, 25);
  assert.strictEqual(kripi.total_charge_usdt, 31.5); // 25 + 5 + 0 + 1.5
  assert.notStrictEqual(bitnob.total_charge_usdt, kripi.total_charge_usdt);
  console.log('ok');
}

function testRoutesWired() {
  section('user routes expose both providers');
  const user = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const instant = fs.readFileSync(path.join(ROOT, 'backend/src/routes/instantCard.js'), 'utf8');
  const standard = fs.readFileSync(path.join(ROOT, 'backend/src/routes/standardCard.js'), 'utf8');
  assert.ok(user.includes("require('./instantCard')"));
  assert.ok(user.includes("require('./standardCard')"));
  assert.ok(instant.includes("'/card/bins'"));
  assert.ok(instant.includes("'/card/pricing-kripicard'"));
  assert.ok(instant.includes("'/card/request-kripicard'") || instant.includes('request-instant'));
  assert.ok(instant.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(standard.includes('assertKycVerifiedForBitnob') || standard.includes('KYC_REQUIRED_FOR_BITNOB'));
  assert.ok(standard.includes('purchaseCardFromUsdtWallet'));
  console.log('ok');
}

function testUiSplit() {
  section('dashboard UI uses Noon switch + dedicated Instant/Standard components');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('cardProviderSwitchShell'));
  assert.ok(html.includes('instantCardView.js'));
  assert.ok(html.includes('standardCardView.js'));
  assert.ok(html.includes('cardProviderSwitch.js'));
  assert.ok(html.includes('data-page="instant-card"'));
  assert.ok(html.includes('data-page="standard-card"'));

  const instantView = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/instantCardView.js'),
    'utf8'
  );
  const standardView = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/standardCardView.js'),
    'utf8'
  );
  assert.ok(instantView.includes('kripicardRequestForm'));
  assert.ok(instantView.includes('kripicardBinSelect'));
  assert.ok(!/bitnob/i.test(instantView));
  assert.ok(standardView.includes('cardRequestForm'));
  assert.ok(!/kripicard/i.test(standardView));

  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('mountCardProviderUi'));
  assert.ok(dash.includes('setCardProviderTab'));
  assert.ok(dash.includes('instantCardView'));
  assert.ok(dash.includes('standardCardView'));
  console.log('ok');
}

function testKripicardClientExports() {
  section('kripicard client exports');
  const k = require(path.join(ROOT, 'lib/kripicard'));
  assert.equal(typeof k.createExternalCard, 'function');
  assert.equal(typeof k.fetchAvailableBins, 'function');
  const issue = require(path.join(ROOT, 'lib/kripicardCardIssue'));
  assert.equal(typeof issue.issueCardForUser, 'function');
  console.log('ok');
}

function main() {
  testModulesExist();
  testPricingSideBySide();
  testRoutesWired();
  testUiSplit();
  testKripicardClientExports();
  console.log('\nDual-provider card checks passed.');
}

main();
