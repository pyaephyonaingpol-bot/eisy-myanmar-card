#!/usr/bin/env node
/**
 * Admin Rate & Pricing section: five dedicated configuration blocks.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '../..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');

const pricingStart = adminHtml.indexOf('id="adminSettingsForm"');
const historyStart = adminHtml.indexOf('<h2 style="margin-top:2rem">Exchange Rate History</h2>');
assert.ok(pricingStart >= 0 && historyStart > pricingStart, 'Rate & Pricing section markers');
const pricingHtml = adminHtml.slice(pricingStart, historyStart);

assert.ok(pricingHtml.includes('Withdraw MMK Rate'), 'block 1: withdraw MMK rate');
assert.ok(pricingHtml.includes('Card Issue Fee / Rate'), 'block 2: card issue fee');
assert.ok(pricingHtml.includes('Card Reload Fee (%)'), 'block 3: card reload percent');
assert.ok(pricingHtml.includes('USDT Deposit Fee / Rate'), 'block 4: USDT deposit fee');
assert.ok(pricingHtml.includes('USDT Withdrawal Fee'), 'block 5: USDT withdrawal fee');

assert.ok(pricingHtml.includes('id="settingExchangeRate"'), 'MMK rate input');
assert.ok(pricingHtml.includes('id="settingCardFee"'), 'card issue fee input');
assert.ok(pricingHtml.includes('id="settingMinUsdtReload"'), 'min USDT reload input');
assert.ok(!pricingHtml.includes('id="settingMinReloadMmk"'), 'min MMK reload input removed');
assert.ok(pricingHtml.includes('id="settingDepositFeePercent"'), 'deposit percent input');
assert.ok(pricingHtml.includes('id="settingWithdrawFeePercent"'), 'withdrawal percent input');
assert.ok(pricingHtml.includes('id="settingWithdrawFeeMinUsdt"'), 'withdrawal min fee input');

assert.ok(!pricingHtml.includes('id="settingDepositFeeMode"'), 'generalized deposit fee mode removed');
assert.ok(!pricingHtml.includes('id="settingReloadFee"'), 'legacy fixed reload fee input removed');
assert.ok(!pricingHtml.includes('P2P trading'), 'P2P block removed from Rate & Pricing');
assert.ok(!pricingHtml.includes('id="settingP2pSellerFee"'), 'P2P seller fee removed from Rate & Pricing');

assert.ok(!adminHtml.includes('id="wrFeeMode"'), 'overview withdrawal fee mode editor removed');
assert.ok(adminHtml.includes('id="btnEditRatesFees"'), 'overview links to Rates & Fees');

assert.ok(adminJs.includes('card_reload_fee_percent'), 'admin saves reload percent');
assert.ok(adminJs.includes('settingWithdrawFeePercent'), 'admin loads withdrawal percent');
assert.ok(adminJs.includes("deposit_service_fee_mode: 'max_percent_or_min'"), 'deposit mode fixed to max(%, min)');
assert.ok(adminJs.includes("withdrawal_service_fee_mode: 'max_percent_or_min'"), 'withdrawal mode fixed to max(%, min)');

process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `eisy-pricing-blocks-${Date.now()}.db`)}`;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

(async () => {
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const {
    updateSettings,
    getCardPricingSettings,
    calculateCardReloadPricingUsdt,
    resolveCardReloadFeeUsd,
  } = require('../src/services/settingsService');

  await updateSettings({
    card_reload_fee_percent: 5,
    card_reload_fee_usd: 3.5,
    minimum_usdt_reload: 5,
    effective_date: '2026-08-31',
    updated_by: 'test',
  });

  const pricing = await getCardPricingSettings();
  assert.strictEqual(pricing.card_reload_fee_percent, 5);

  assert.strictEqual(resolveCardReloadFeeUsd(100, pricing), 5);
  const reload = calculateCardReloadPricingUsdt(100, pricing);
  assert.strictEqual(reload.reload_fee_usd, 5);
  assert.strictEqual(reload.deposit_usdt, 105);

  console.log('Admin Rate & Pricing five blocks — ok');
  await closeDb();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
