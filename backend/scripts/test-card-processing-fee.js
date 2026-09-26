#!/usr/bin/env node
/**
 * Card checkout fees: Bitnob create ($2) + Bitnob funding schedule + platform fees.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testConstants() {
  section('Bitnob fee schedule + processing fee constants');
  const { CARD_PROCESSING_FEE_USD } = require('../src/constants/cardIssuanceFees');
  const {
    BITNOB_CARD_CREATE_FEE_USD,
    resolveBitnobFundingFeeUsd,
  } = require('../src/constants/bitnobFees');

  assert.strictEqual(CARD_PROCESSING_FEE_USD, 1.5);
  assert.strictEqual(BITNOB_CARD_CREATE_FEE_USD, 2);
  assert.strictEqual(resolveBitnobFundingFeeUsd(50), 1); // <$100 → $1
  assert.strictEqual(resolveBitnobFundingFeeUsd(99.99), 1);
  assert.strictEqual(resolveBitnobFundingFeeUsd(100), 1); // 1% of 100
  assert.strictEqual(resolveBitnobFundingFeeUsd(250), 2.5); // 1% of 250
  console.log('ok');
}

function testPricingFormula() {
  section('calculateCardRequestPricingUsdt uses Bitnob create + funding fees');
  const { calculateCardRequestPricingUsdt, CARD_PROCESSING_FEE_USD } = require('../src/services/settingsService');

  const pricing = calculateCardRequestPricingUsdt(100, {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
  });

  assert.strictEqual(CARD_PROCESSING_FEE_USD, 1.5);
  assert.strictEqual(pricing.initial_load_usd, 100);
  assert.strictEqual(pricing.bitnob_create_fee_usd, 2);
  assert.strictEqual(pricing.bitnob_funding_fee_usd, 1); // 1% of $100
  assert.strictEqual(pricing.platform_issuance_fee_usd, 5);
  assert.strictEqual(pricing.issuance_fee_usd, 7); // 2 + 5
  assert.strictEqual(pricing.funding_fee_usd, 1);
  assert.strictEqual(pricing.processing_fee_usd, 1.5);
  // Total = 100 + 2 + 1 + 5 + 1.50
  assert.strictEqual(pricing.total_usd_required, 109.5);
  assert.strictEqual(pricing.total_charge_usdt, 109.5);
  assert.strictEqual(pricing.platform_markup_usd, 6.5);
  assert.strictEqual(pricing.provider_load_usd, 100);
  assert.strictEqual(pricing.mmk_wallet_allowed, false);
  assert.strictEqual(pricing.payment_wallet, 'usdt');
  console.log('ok');
}

function testReloadPricing() {
  section('calculateCardReloadPricingUsdt uses Bitnob funding fee');
  const { calculateCardReloadPricingUsdt } = require('../src/services/settingsService');

  const small = calculateCardReloadPricingUsdt(40, {
    minimum_usdt_reload: 5,
    card_reload_fee_usd: 2,
  });
  assert.strictEqual(small.bitnob_funding_fee_usd, 1);
  assert.strictEqual(small.platform_reload_markup_usd, 2);
  assert.strictEqual(small.reload_fee_usd, 3);
  assert.strictEqual(small.deposit_usdt, 43);
  assert.strictEqual(small.mmk_wallet_allowed, false);

  const large = calculateCardReloadPricingUsdt(200, {
    minimum_usdt_reload: 5,
    card_reload_fee_usd: 0,
  });
  assert.strictEqual(large.bitnob_funding_fee_usd, 2); // 1% of 200
  assert.strictEqual(large.reload_fee_usd, 2);
  assert.strictEqual(large.deposit_usdt, 202);
  console.log('ok');
}

function testUiWiring() {
  section('Checkout UI + Bitnob fee wiring');
  const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
  const userRoute = fs.readFileSync(path.join(ROOT, 'src/routes/user.js'), 'utf8');
  const wallet = fs.readFileSync(path.join(ROOT, 'src/services/walletService.js'), 'utf8');

  assert.ok(index.includes('id="pbFundingFee"'), 'funding fee row');
  assert.ok(index.includes('id="pbProcessingFee"'), 'processing fee row');
  assert.ok(dash.includes('bitnob_create_fee_usd') || dash.includes('bitnob_fee_schedule'), 'dashboard Bitnob fees');
  assert.ok(userRoute.includes('bitnob_create_fee_usd'), 'pricing API exposes Bitnob create fee');
  assert.ok(userRoute.includes('wallet_rules'), 'pricing API exposes wallet rules');
  assert.ok(wallet.includes('mmk_bank_withdrawal'), 'MMK restricted to bank withdrawal');
  assert.ok(wallet.includes('USDT_ONLY_CARD_ISSUANCE'), 'card issue USDT-only');
  console.log('ok');
}

function main() {
  testConstants();
  testPricingFormula();
  testReloadPricing();
  testUiWiring();
  console.log('\nCard processing / Bitnob fee checks passed.');
}

main();
