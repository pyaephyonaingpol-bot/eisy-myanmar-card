#!/usr/bin/env node
/**
 * Card issuance profit markup: user pays load + Bitnob fees + platform markup;
 * Bitnob receives load only; markup lands in platform_fee_events.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testPricingBreakdown() {
  section('calculateCardRequestPricingUsdt includes Bitnob $2 create + funding schedule');
  const { calculateCardRequestPricingUsdt } = require('../src/services/settingsService');

  const pricing = calculateCardRequestPricingUsdt(25, {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
  });

  assert.strictEqual(pricing.provider_load_usd, 25);
  assert.strictEqual(pricing.bitnob_create_fee_usd, 2);
  assert.strictEqual(pricing.bitnob_funding_fee_usd, 1); // <$100 → $1
  assert.strictEqual(pricing.platform_issuance_fee_usd, 5);
  assert.strictEqual(pricing.issuance_fee_usd, 7); // Bitnob create + platform
  assert.strictEqual(pricing.funding_fee_usd, 1);
  assert.strictEqual(pricing.processing_fee_usd, 1.5);
  assert.strictEqual(pricing.platform_markup_usd, 6.5); // platform issuance + processing
  assert.strictEqual(pricing.total_charge_usdt, 34.5); // 25+2+1+5+1.5
  assert.strictEqual(pricing.payment_wallet, 'usdt');
  assert.strictEqual(pricing.mmk_wallet_allowed, false);
  assert.ok(pricing.note.includes('Bitnob'));
  console.log('ok');
}

function testWalletServiceMarkupFlow() {
  section('purchaseCardFromUsdtWallet debits total and sends load only');
  const src = fs.readFileSync(path.join(ROOT, 'backend/src/services/cardWalletService.js'), 'utf8');

  assert.ok(src.includes('ensureSupabaseUserWallet'), 'ensures Supabase wallet before debit');
  assert.ok(src.includes('provider_load_usd'), 'tracks provider load');
  assert.ok(src.includes('bitnob_create_fee_usd'), 'tracks Bitnob create fee');
  assert.ok(src.includes('bitnob_funding_fee_usd'), 'tracks Bitnob funding fee');
  assert.ok(src.includes('platform_markup_usd'), 'tracks platform markup');
  assert.ok(src.includes('amount: providerLoadUsd'), 'provider receives load only');
  assert.ok(src.includes('recordPlatformUsdFee(platformMarkupUsd'), 'markup recorded in ledger');
  assert.ok(src.includes('total_charge_usdt: requiredUsdt'), 'metadata includes total charge');
  console.log('ok');
}

function testCardsIssueRouteUsesWalletPurchase() {
  section('POST /api/user/cards/issue uses wallet purchase + markup');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');

  const issueIdx = route.indexOf("router.post('/cards/issue'");
  const meIdx = route.indexOf("router.get('/me'");
  assert.ok(issueIdx >= 0 && meIdx > issueIdx);
  const issueBlock = route.slice(issueIdx, meIdx);

  assert.ok(issueBlock.includes('purchaseCardFromUsdtWallet'), 'cards/issue delegates to wallet purchase');
  assert.ok(!issueBlock.includes('issueCardForUser({'), 'cards/issue no longer calls provider directly');
  assert.ok(issueBlock.includes('initial_load_usd ?? body.amount'), 'amount maps to card load not total charge');
  assert.ok(issueBlock.includes('buildCardPurchaseSuccessPayload'), 'shared success payload');
  assert.ok(issueBlock.includes('respondCardPurchaseError'), 'shared error handler');
  console.log('ok');
}

function testNextCardsIssueRoute() {
  section('Next.js /api/cards/issue user path uses wallet purchase');
  const src = fs.readFileSync(path.join(ROOT, 'app/api/cards/issue/route.js'), 'utf8');

  assert.ok(src.includes('purchaseCardFromUsdtWallet'), 'user session uses wallet purchase');
  assert.ok(src.includes('createAndPersistBitnobCard'), 'admin path uses Bitnob');
  assert.ok(src.includes('isAdmin'), 'admin bypass preserved');
  assert.ok(src.includes('BITNOB_'), 'Bitnob env / error codes');
  assert.ok(!src.includes('KRIPICARD') && !src.includes('Kripicard'), 'no Kripicard in issue route');
  assert.ok(src.includes('platform_markup_usd') || src.includes('pricing_breakdown'), 'returns pricing breakdown');
  console.log('ok');
}

function testCardRequestRouteSharesPurchase() {
  section('POST /api/user/card/request still uses shared purchase flow');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const idx = route.indexOf("router.post('/card/request'");
  assert.ok(idx >= 0);
  const block = route.slice(idx, idx + 1200);
  assert.ok(block.includes('purchaseCardFromUsdtWallet'));
  assert.ok(block.includes('USDT_ONLY_CARD_ISSUANCE'));
  console.log('ok');
}

function main() {
  testPricingBreakdown();
  testWalletServiceMarkupFlow();
  testCardsIssueRouteUsesWalletPurchase();
  testNextCardsIssueRoute();
  testCardRequestRouteSharesPurchase();
  console.log('\nAll card issuance profit markup tests passed.');
}

main();
