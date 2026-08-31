#!/usr/bin/env node
/**
 * Card issuance profit markup: user pays load + admin fee;
 * Kripicard receives load only; markup lands in platform_fee_events.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testPricingBreakdown() {
  section('calculateCardRequestPricingUsdt exposes markup split');
  const { calculateCardRequestPricingUsdt } = require('../src/services/settingsService');

  const pricing = calculateCardRequestPricingUsdt(25, {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
  });

  assert.strictEqual(pricing.kripicard_cost_usd, 25);
  assert.strictEqual(pricing.platform_markup_usd, 5);
  assert.strictEqual(pricing.initial_load_usd, 25);
  assert.strictEqual(pricing.issuance_fee_usd, 5);
  assert.strictEqual(pricing.total_charge_usdt, 30);
  assert.strictEqual(pricing.total_usdt, 30);
  assert.strictEqual(pricing.total_usd_required, 30);
  assert.ok(pricing.note.includes('Kripicard'));
  console.log('ok');
}

function testWalletServiceMarkupFlow() {
  section('purchaseCardFromUsdtWallet debits total and sends load only');
  const src = fs.readFileSync(path.join(ROOT, 'backend/src/services/cardWalletService.js'), 'utf8');

  assert.ok(src.includes('ensureSupabaseUserWallet'), 'ensures Supabase wallet before debit');
  assert.ok(src.includes('kripicard_cost_usd'), 'tracks Kripicard cost');
  assert.ok(src.includes('platform_markup_usd'), 'tracks platform markup');
  assert.ok(src.includes('amount: kripicardCostUsd'), 'provider receives load only');
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
  assert.ok(src.includes('isAdmin'), 'admin bypass preserved');
  assert.ok(src.includes('platform_markup_usd') || src.includes('pricing_breakdown'), 'returns pricing breakdown');
  console.log('ok');
}

function testCardRequestRoute() {
  section('POST /api/user/card/request still uses shared purchase flow');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  assert.ok(route.includes('buildCardPurchaseSuccessPayload(result)'));
  assert.ok(route.includes('respondCardPurchaseError(res, err, \'user/card/request\')'));
  console.log('ok');
}

async function main() {
  testPricingBreakdown();
  testWalletServiceMarkupFlow();
  testCardsIssueRouteUsesWalletPurchase();
  testNextCardsIssueRoute();
  testCardRequestRoute();
  console.log('\nAll card issuance profit markup tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
