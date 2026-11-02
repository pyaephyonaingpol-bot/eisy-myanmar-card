#!/usr/bin/env node
/**
 * Test True P2P Escrow Lifecycle:
 * 1. Seller creates Sell Ad -> Locks USDT in escrow
 * 2. Buyer creates Buy Order -> Reserves volume
 * 3. Buyer confirms MMK transfer -> Pending seller release
 * 4. Seller releases order -> Internal wallet transfer to Buyer (No blockchain withdrawal)
 * 5. Buyer explicitly requests withdrawal -> Creates withdrawal record & debits balance
 * 6. Seller cancels remaining ad -> Refunds escrow to Seller
 * 7. Buyer creates Buy Ad & Seller creates Sell Order -> Escrows Seller USDT & releases internally
 * 8. Dispute resolution -> Admin force release & refund tests
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();
process.env.AUTO_ONCHAIN_WITHDRAWALS = 'false';

const assert = require('assert');
const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const P2PAd = require('../src/models/P2PAd');
const P2PBuyOrder = require('../src/models/P2PBuyOrder');
const P2PSellOrder = require('../src/models/P2PSellOrder');
const UsdtWithdrawal = require('../src/models/UsdtWithdrawal');
const { creditAvailable, getUsdtBalances } = require('../src/services/usdtLedgerService');
const { createP2pAd, cancelP2pAd } = require('../src/services/p2pAdService');
const {
  createP2pBuyOrder,
  confirmMmkTransfer,
  releaseP2pBuyOrderByMaker,
} = require('../src/services/p2pBuyOrderService');
const {
  createP2pSellOrder,
  confirmMmkAndReleaseUsdt,
} = require('../src/services/p2pSellOrderService');
const { createUsdtWithdrawalRequest } = require('../src/services/withdrawalService');
const { openP2pBuyDispute, resolveDispute } = require('../src/services/p2pDisputeService');

async function createTestUser(email, name, phone, { mmkBalance = 50000 } = {}) {
  const db = getDb();
  const existing = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) {
    await db.run(
      `UPDATE users SET balance_usdt = 0, balance_usdt_locked = 0, balance_mmk = ?, kyc_status = 'VERIFIED', auth_status = 'active' WHERE id = ?`,
      mmkBalance,
      existing.id
    );
    return User.findById(existing.id);
  }
  const u = await User.create({
    email,
    name,
    phone: phone || null,
    pinHash: 'hash123',
  });
  await db.run(
    `UPDATE users SET kyc_status = 'VERIFIED', auth_status = 'active', balance_mmk = ? WHERE id = ?`,
    mmkBalance,
    u.id
  );
  return User.findById(u.id);
}

async function getMmkBalance(userId) {
  const db = getDb();
  const row = await db.get('SELECT balance_mmk FROM users WHERE id = ?', userId);
  return Number(row?.balance_mmk || 0);
}

async function runTests() {
  console.log('[test-p2p-true-escrow] Initializing database...');
  await initDb();
  const db = getDb();

  console.log('[test-p2p-true-escrow] Setting up test users Seller A and Buyer B...');
  const sellerA = await createTestUser('seller_a_test@eisy.local', 'Seller A', '09111111111', { mmkBalance: 75000 });
  const buyerB = await createTestUser('buyer_b_test@eisy.local', 'Buyer B', '09222222222', { mmkBalance: 120000 });
  const sellerMmkStart = await getMmkBalance(sellerA.id);
  const buyerMmkStart = await getMmkBalance(buyerB.id);
  assert.strictEqual(sellerMmkStart, 75000, 'Seller MMK seed');
  assert.strictEqual(buyerMmkStart, 120000, 'Buyer MMK seed');
  console.log('    ✓ MMK wallet seeded (isolated from P2P escrow — external MMK only)');

  // 1. Fund Seller A with 100 USDT available
  console.log('[1] Funding Seller A with 100 USDT...');
  await creditAvailable(sellerA.id, 100, {
    txType: 'balance_credit',
    description: 'Initial funding for test Seller A',
  });

  let sellerBal = await getUsdtBalances(sellerA.id);
  assert.strictEqual(sellerBal.available_usdt, 100, 'Seller A should have 100 USDT available');
  assert.strictEqual(sellerBal.locked_usdt, 0, 'Seller A should have 0 locked');

  // 2. Seller A creates a Sell Ad for 50 USDT at 4500 MMK/USDT
  console.log('[2] Seller A creates a Sell Ad for 50 USDT...');
  const adResult = await createP2pAd(sellerA.id, {
    side: 'sell',
    network: 'TRC20',
    price_mmk_per_usdt: 4500,
    total_volume_usdt: 50,
    min_order_usdt: 10,
    max_order_usdt: 50,
    payment_methods: ['KPay', 'WavePay'],
    kpay_account_name: 'Seller A',
    kpay_account_number: '09111111111',
    wave_account_name: 'Seller A',
    wave_account_number: '09111111111',
  });

  const ad = adResult.ad;
  assert.ok(ad && ad.id, 'Sell ad should be created');
  assert.strictEqual(ad.escrow_locked_usdt, 50, 'Ad should record 50 USDT escrow locked');
  assert.strictEqual(ad.available_volume_usdt, 50, 'Ad available volume should be 50 USDT');

  sellerBal = await getUsdtBalances(sellerA.id);
  assert.strictEqual(sellerBal.available_usdt, 50, 'Seller A available should drop to 50 USDT');
  assert.strictEqual(sellerBal.locked_usdt, 50, 'Seller A locked should increase to 50 USDT');
  console.log('    ✓ Seller A USDT balance locked in escrow correctly:', sellerBal);

  // 3. Buyer B creates a Buy Order for 20 USDT
  console.log('[3] Buyer B creates a Buy Order for 20 USDT from Seller A ad...');
  const buyOrderResult = await createP2pBuyOrder(buyerB.id, {
    ad_id: ad.id,
    amount_usdt: 20,
    payment_method: 'KPay',
  });

  const buyOrder = buyOrderResult.order;
  assert.ok(buyOrder && buyOrder.id, 'Buy order should be created');
  assert.strictEqual(buyOrder.status, 'pending_payment', 'Order should be in pending_payment');
  assert.strictEqual(buyOrder.amount_usdt, 20, 'Order amount should be 20 USDT');
  assert.strictEqual(buyOrder.amount_mmk, 90000, 'Order amount MMK should be 20 * 4500 = 90000');

  const adAfterOrder = await P2PAd.findById(ad.id);
  assert.strictEqual(Number(adAfterOrder.available_volume_usdt), 30, 'Ad available volume should decrease to 30');
  console.log('    ✓ Volume reserved on ad, order in pending_payment');

  // 4. Buyer B confirms MMK payment
  console.log('[4] Buyer B confirms MMK transfer...');
  const confirmResult = await confirmMmkTransfer(buyOrder.id, buyerB.id, {
    proofPath: '/uploads/p2p/mock_receipt.jpg',
    proofOriginalName: 'receipt.jpg',
    proofMimeType: 'image/jpeg',
    txRef: 'KPAY123456789',
  });

  assert.strictEqual(confirmResult.order.status, 'pending_seller_release', 'Order status should be pending_seller_release');
  console.log('    ✓ Order updated to pending_seller_release');

  // 5. Seller A releases the order
  console.log('[5] Seller A confirms MMK receipt and releases USDT...');
  const releaseResult = await releaseP2pBuyOrderByMaker(buyOrder.id, sellerA.id);
  assert.strictEqual(releaseResult.order.status, 'released', 'Order status should be released');

  sellerBal = await getUsdtBalances(sellerA.id);
  const buyerBal = await getUsdtBalances(buyerB.id);

  assert.strictEqual(sellerBal.available_usdt, 50, 'Seller A available balance should remain 50 USDT');
  assert.strictEqual(sellerBal.locked_usdt, 30, 'Seller A locked balance should reduce from 50 to 30 USDT');
  assert.ok(buyerBal.available_usdt >= 19.8 && buyerBal.available_usdt <= 20.0, 'Buyer B should receive net USDT');
  assert.strictEqual(buyerBal.locked_usdt, 0, 'Buyer B should have 0 locked');

  const adAfterRelease = await P2PAd.findById(ad.id);
  assert.strictEqual(Number(adAfterRelease.escrow_locked_usdt), 30, 'Ad escrow locked should reduce from 50 to 30');
  console.log('    ✓ True Escrow release complete! Internal wallet transfer succeeded without blockchain trigger.');
  console.log('    Seller A balances:', sellerBal);
  console.log('    Buyer B balances:', buyerBal);

  // 6. Buyer B explicitly requests a withdrawal from their internal wallet
  console.log('[6] Buyer B explicitly requests a USDT TRC20 withdrawal of 10 USDT...');
  const initialBuyerAvail = buyerBal.available_usdt;
  const withdrawResult = await createUsdtWithdrawalRequest(buyerB.id, {
    network: 'TRC20',
    wallet_address: 'TNTU3x2BLuJg3MQCnk6hne43NpgphMK2NJ',
    amount_usdt: 10,
    payout_method: 'crypto',
  });

  assert.ok(withdrawResult && withdrawResult.withdrawal, 'Withdrawal request created');
  assert.strictEqual(withdrawResult.withdrawal.status, 'pending', 'Withdrawal should be pending');
  const buyerBalAfterWithdraw = await getUsdtBalances(buyerB.id);
  assert.strictEqual(
    buyerBalAfterWithdraw.available_usdt,
    Math.round((initialBuyerAvail - 10) * 100) / 100,
    'Buyer B available USDT should be debited by 10'
  );
  console.log('    ✓ Explicit withdrawal created and wallet balance debited properly');

  // 7. Seller A cancels the remaining 30 USDT from the Sell Ad
  console.log('[7] Seller A cancels the remaining 30 USDT ad volume...');
  const cancelResult = await cancelP2pAd(sellerA.id, ad.id);
  assert.strictEqual(cancelResult.ad.status, 'cancelled', 'Ad status should be cancelled');

  sellerBal = await getUsdtBalances(sellerA.id);
  assert.strictEqual(sellerBal.available_usdt, 80, 'Seller A available balance should be refunded to 80 (50 + 30)');
  assert.strictEqual(sellerBal.locked_usdt, 0, 'Seller A locked balance should be 0');
  console.log('    ✓ Ad cancelled and remaining escrow refunded to Seller A:', sellerBal);

  // 8. New buy ads are rejected. A legacy buy-ad row can still take a USDT-escrowed sell order.
  console.log('[8] Testing rejected buy ad and legacy sell-order escrow...');
  await assert.rejects(
    () => createP2pAd(buyerB.id, {
      side: 'buy',
      network: 'TRC20',
      price_mmk_per_usdt: 4400,
      total_volume_usdt: 30,
      min_order_usdt: 10,
      max_order_usdt: 30,
      payment_methods: ['KPay'],
      kpay_account_name: 'Buyer B',
      kpay_account_number: '09222222222',
    }),
    (err) => err && err.code === 'P2P_BUY_AD_DISABLED'
  );
  const buyAd = await P2PAd.create({
    userId: buyerB.id,
    side: 'buy',
    network: 'TRC20',
    priceMmkPerUsdt: 4400,
    totalVolumeUsdt: 30,
    availableVolumeUsdt: 30,
    minOrderUsdt: 10,
    maxOrderUsdt: 30,
    paymentMethods: ['KPay'],
    paymentAccounts: { KPay: { account_name: 'Buyer B', account_number: '09222222222' } },
    escrowLockedUsdt: 0,
  });
  assert.strictEqual(Number(buyAd.escrow_locked_usdt || 0), 0, 'Legacy buy ad should have 0 escrow locked');

  // Seller A sells 25 USDT to Buyer B's Buy Ad
  console.log('    Seller A creates Sell Order for 25 USDT against Buyer B ad...');
  const sellOrderResult = await createP2pSellOrder(sellerA.id, {
    ad_id: buyAd.id,
    amount_usdt: 25,
    payment_method: 'KPay',
    account_name: 'Seller A',
    account_number: '09111111111',
  });
  const sellOrder = sellOrderResult.order;
  assert.strictEqual(sellOrder.status, 'pending_merchant_mmk', 'Sell order status should be pending_merchant_mmk');

  sellerBal = await getUsdtBalances(sellerA.id);
  assert.strictEqual(sellerBal.available_usdt, 55, 'Seller A available should drop from 80 to 55');
  assert.strictEqual(sellerBal.locked_usdt, 25, 'Seller A locked should increase to 25');

  // Seller A confirms receipt of MMK and releases USDT
  console.log('    Seller A confirms MMK receipt and releases Sell Order...');
  const sellReleaseResult = await confirmMmkAndReleaseUsdt(sellOrder.id, sellerA.id);
  assert.strictEqual(sellReleaseResult.order.status, 'released', 'Sell order should be released');

  sellerBal = await getUsdtBalances(sellerA.id);
  assert.strictEqual(sellerBal.locked_usdt, 0, 'Seller A locked balance should return to 0');
  assert.strictEqual(sellerBal.available_usdt, 55, 'Seller A available balance should be 55');
  console.log('    ✓ Sell order escrow release succeeded cleanly');

  // 9. Test Dispute flow on Buy Order
  console.log('[9] Testing Dispute Flow...');
  const ad2Result = await createP2pAd(sellerA.id, {
    side: 'sell',
    network: 'TRC20',
    price_mmk_per_usdt: 4500,
    total_volume_usdt: 20,
    min_order_usdt: 10,
    max_order_usdt: 20,
    payment_methods: ['KPay'],
    kpay_account_name: 'Seller A',
    kpay_account_number: '09111111111',
  });
  const ad2 = ad2Result.ad;

  const buyOrder2Result = await createP2pBuyOrder(buyerB.id, {
    ad_id: ad2.id,
    amount_usdt: 20,
    payment_method: 'KPay',
  });
  const buyOrder2 = buyOrder2Result.order;

  await confirmMmkTransfer(buyOrder2.id, buyerB.id, {
    proofPath: '/uploads/p2p/mock_receipt2.jpg',
    txRef: 'KPAY999888',
  });

  // Open dispute
  console.log('    Buyer B opens dispute...');
  const disputedOrder = await openP2pBuyDispute(buyOrder2.id, buyerB.id, {
    reason: 'Seller not releasing after valid payment',
    proofPath: '/uploads/p2p/mock_receipt2.jpg',
  });
  assert.strictEqual(disputedOrder.dispute_status, 'open', 'Dispute status should be open');

  // Admin resolves dispute with force_release
  console.log('    Admin force-releases dispute to Buyer B...');
  const resolveResult = await resolveDispute('buy', buyOrder2.id, {
    resolution: 'force_release',
    adminNote: 'Admin confirmed payment proof is valid',
    reviewedBy: 'admin',
  });
  assert.ok(resolveResult.order, 'Order resolved');
  assert.strictEqual(resolveResult.order.status, 'completed_by_admin', 'Order status should be completed_by_admin');

  // 10. MMK wallet ledger must remain untouched by P2P escrow / buy-sell flows
  console.log('[10] Verifying MMK wallet ledger isolation from P2P escrow...');
  assert.strictEqual(await getMmkBalance(sellerA.id), sellerMmkStart, 'Seller MMK wallet unchanged after P2P');
  assert.strictEqual(await getMmkBalance(buyerB.id), buyerMmkStart, 'Buyer MMK wallet unchanged after P2P');

  // Route-level guard: internal MMK wallet cannot pay for P2P buys
  const p2pRoute = require('fs').readFileSync(
    require('path').join(__dirname, '../src/routes/p2p.js'),
    'utf8'
  );
  assert.ok(p2pRoute.includes('use_mmk_wallet'), 'P2P buy route rejects MMK wallet payment');
  assert.ok(p2pRoute.includes('internal MMK wallet is not used'), 'P2P buy documents external MMK only');

  const { assertMmkDebitAllowed } = require('../src/services/walletService');
  assert.throws(
    () => assertMmkDebitAllowed({ createdBy: 'user', metadata: { purpose: 'p2p_buy' } }),
    (err) => err.code === 'MMK_WALLET_RESTRICTED',
    'MMK ledger rejects P2P debit purpose'
  );
  assert.doesNotThrow(
    () => assertMmkDebitAllowed({ createdBy: 'user', metadata: { purpose: 'mmk_bank_withdrawal' } }),
    'MMK ledger still allows bank withdrawals'
  );
  console.log('    ✓ MMK wallet ledger isolated; P2P uses external MMK + USDT escrow only');

  console.log('\n========================================');
  console.log('🎉 ALL TRUE P2P ESCROW TESTS PASSED! 🎉');
  console.log('========================================\n');

  await closeDb();
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
