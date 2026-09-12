#!/usr/bin/env node
/**
 * Card checkout: Initial Load + Issuance Fee + Funding Fee(%) + Processing Fee ($1.50)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testConstants() {
  section('CARD_PROCESSING_FEE_USD is fixed at 1.50');
  const { CARD_PROCESSING_FEE_USD, resolveCardFundingFeeUsd } = require('../src/constants/cardIssuanceFees');
  assert.strictEqual(CARD_PROCESSING_FEE_USD, 1.5);
  assert.strictEqual(resolveCardFundingFeeUsd(100, { card_funding_fee_percent: 2 }), 2);
  assert.strictEqual(resolveCardFundingFeeUsd(100, { card_funding_fee_percent: 0 }), 0);
  console.log('ok');
}

function testPricingFormula() {
  section('calculateCardRequestPricingUsdt includes funding % + $1.50 processing');
  const { calculateCardRequestPricingUsdt, CARD_PROCESSING_FEE_USD } = require('../src/services/settingsService');

  const pricing = calculateCardRequestPricingUsdt(100, {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
    card_funding_fee_percent: 2,
  });

  assert.strictEqual(CARD_PROCESSING_FEE_USD, 1.5);
  assert.strictEqual(pricing.initial_load_usd, 100);
  assert.strictEqual(pricing.issuance_fee_usd, 5);
  assert.strictEqual(pricing.funding_fee_percent, 2);
  assert.strictEqual(pricing.funding_fee_usd, 2);
  assert.strictEqual(pricing.processing_fee_usd, 1.5);
  // Total Payable = 100 + 5 + 2 + 1.50
  assert.strictEqual(pricing.total_usd_required, 108.5);
  assert.strictEqual(pricing.total_charge_usdt, 108.5);
  assert.strictEqual(pricing.platform_markup_usd, 8.5);
  assert.strictEqual(pricing.kripicard_cost_usd, 100);
  console.log('ok');
}

function testUiWiring() {
  section('Checkout UI + admin funding fee wiring');
  const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  const userRoute = fs.readFileSync(path.join(ROOT, 'src/routes/user.js'), 'utf8');

  assert.ok(index.includes('id="pbFundingFee"'), 'funding fee row');
  assert.ok(index.includes('id="pbProcessingFee"'), 'processing fee row');
  assert.ok(dash.includes('card_funding_fee_percent'), 'dashboard reads funding %');
  assert.ok(dash.includes('card_processing_fee_usd') || dash.includes('processingFeeUsd'), 'dashboard processing fee');
  assert.ok(adminHtml.includes('settingFundingFeePercent'), 'admin funding input');
  assert.ok(adminJs.includes('card_funding_fee_percent'), 'admin saves funding %');
  assert.ok(userRoute.includes('card_funding_fee_percent'), 'pricing API exposes funding %');
  assert.ok(userRoute.includes('card_processing_fee_usd'), 'pricing API exposes processing fee');
  console.log('ok');
}

function main() {
  testConstants();
  testPricingFormula();
  testUiWiring();
  console.log('\nCard processing fee checks passed.');
}

main();
