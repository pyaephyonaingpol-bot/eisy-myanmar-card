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
  const src = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  assert.ok(src.includes("router.get('/card/bins'"));
  assert.ok(src.includes("router.get('/card/pricing-kripicard'"));
  assert.ok(src.includes("router.post('/card/request-kripicard'"));
  assert.ok(src.includes('assertKycVerifiedForBitnob'));
  assert.ok(src.includes('purchaseKripicardFromUsdtWallet'));
  assert.ok(src.includes('KYC_REQUIRED_FOR_BITNOB'));
  console.log('ok');
}

function testUiSplit() {
  section('dashboard UI has dual provider panels');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('kripicardRequestForm'));
  assert.ok(html.includes('cardRequestForm'));
  assert.ok(html.includes('tabInstantCard'));
  assert.ok(html.includes('tabStandardCard'));
  assert.ok(html.includes('kripicardBinSelect'));
  assert.ok(html.includes('card-provider-switch'));
  assert.ok(html.includes('card-provider-switch-thumb'));
  assert.ok(html.includes('card-provider-switch-footer'));
  assert.ok(html.includes('pill_instant_card'));
  assert.ok(html.includes('pill_standard_card'));
  assert.ok(html.includes('pill_no_kyc'));
  assert.ok(html.includes('pill_verified'));
  // Visible switch labels must not expose vendor names.
  const titleMatches = [...html.matchAll(/card-provider-tab-title[^>]*>([^<]*)</g)].map((m) => m[1]);
  const subMatches = [...html.matchAll(/card-provider-tab-sub[^>]*>([^<]*)</g)].map((m) => m[1]);
  for (const label of [...titleMatches, ...subMatches]) {
    assert.ok(!/Kripicard|Bitnob/i.test(label), `switch label must not show vendor names: ${label}`);
  }
  assert.ok(titleMatches.includes('Instant Card'));
  assert.ok(titleMatches.includes('Standard Card'));
  assert.ok(subMatches.includes('No KYC'));
  assert.ok(subMatches.includes('Verified'));

  const i18n = fs.readFileSync(path.join(ROOT, 'backend/public/i18n.js'), 'utf8');
  assert.ok(i18n.includes("pill_instant_card: 'Instant Card'"));
  assert.ok(i18n.includes("pill_standard_card: 'Standard Card'"));
  assert.ok(i18n.includes("pill_no_kyc: 'No KYC'"));
  assert.ok(i18n.includes("pill_verified: 'Verified'"));

  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('bindCardProviderTabs'));
  assert.ok(dash.includes('/api/user/card/request-kripicard'));
  assert.ok(dash.includes('setCardProviderTab'));
  assert.ok(dash.includes('data-active'));

  const css = fs.readFileSync(path.join(ROOT, 'backend/public/styles.css'), 'utf8');
  assert.ok(css.includes('.card-provider-switch-thumb'));
  assert.ok(css.includes('cardProviderPanelIn'));
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
