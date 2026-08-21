#!/usr/bin/env node
/**
 * Regression: legacy sell ads with escrow_locked_usdt but no usdt_escrow_holds row
 * should backfill on release instead of "Active escrow hold not found".
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const assert = require('assert');
const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const { creditAvailable, getUsdtBalances } = require('../src/services/usdtLedgerService');
const {
  createP2pBuyOrder,
  confirmMmkTransfer,
  releaseP2pBuyOrderByMaker,
} = require('../src/services/p2pBuyOrderService');
const { cancelP2pAd } = require('../src/services/p2pAdService');

async function createTestUser(email, name, phone) {
  const db = getDb();
  const existing = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) {
    await db.run(
      `UPDATE users SET balance_usdt = 0, balance_usdt_locked = 0, kyc_status = 'VERIFIED', auth_status = 'active' WHERE id = ?`,
      existing.id
    );
    return User.findById(existing.id);
  }
  const u = await User.create({ email, name, phone: phone || '09123456789', pinHash: 'hash123' });
  await db.run(`UPDATE users SET kyc_status = 'VERIFIED', auth_status = 'active' WHERE id = ?`, u.id);
  return User.findById(u.id);
}

async function createLegacySellAdWithoutHold(db, sellerId, volumeUsdt) {
  const result = await db.run(`
    INSERT INTO p2p_ads (
      user_id, side, network, price_mmk_per_usdt,
      total_volume_usdt, available_volume_usdt,
      min_order_usdt, max_order_usdt,
      payment_methods, payment_accounts, escrow_locked_usdt, status
    ) VALUES (?, 'sell', 'TRC20', 4500, ?, ?, 10, ?, ?, ?, ?, 'active')
  `,
    sellerId,
    volumeUsdt,
    volumeUsdt,
    volumeUsdt,
    '["KPay"]',
    JSON.stringify({ KPay: { account_name: 'Legacy Seller', account_number: '09123456789' } }),
    volumeUsdt
  );

  await db.run(
    `UPDATE users SET balance_usdt = balance_usdt - ?, balance_usdt_locked = balance_usdt_locked + ? WHERE id = ?`,
    volumeUsdt,
    volumeUsdt,
    sellerId
  );

  return result.lastID;
}

async function run() {
  console.log('[test-escrow-hold-backfill] Initializing...');
  await initDb();
  const db = getDb();

  const seller = await createTestUser('legacy_seller_escrow@eisy.local', 'Legacy Seller', `09${Date.now().toString().slice(-8)}`);
  const buyer = await createTestUser('legacy_buyer_escrow@eisy.local', 'Legacy Buyer', `09${(Date.now() + 1).toString().slice(-8)}`);

  await creditAvailable(seller.id, 100, {
    txType: 'balance_credit',
    description: 'Fund legacy seller',
  });

  const adId = await createLegacySellAdWithoutHold(db, seller.id, 50);
  const holdBefore = await db.get(
    `SELECT * FROM usdt_escrow_holds WHERE reference_type = 'p2p_ads' AND reference_id = ?`,
    adId
  );
  assert.strictEqual(holdBefore, undefined, 'Legacy ad should start without escrow hold row');

  let sellerBal = await getUsdtBalances(seller.id);
  assert.strictEqual(sellerBal.available_usdt, 50, 'Seller should have 50 available after legacy lock');
  assert.strictEqual(sellerBal.locked_usdt, 50, 'Seller should have 50 locked after legacy lock');

  console.log('[test-escrow-hold-backfill] Creating buy order against legacy ad...');
  const { order } = await createP2pBuyOrder(buyer.id, {
    ad_id: adId,
    amount_usdt: 20,
    payment_method: 'KPay',
  });

  const holdAfterOrder = await db.get(
    `SELECT * FROM usdt_escrow_holds WHERE reference_type = 'p2p_ads' AND reference_id = ? AND status = 'active'`,
    adId
  );
  assert(holdAfterOrder, 'Buy order creation should backfill missing escrow hold');
  assert.strictEqual(Number(holdAfterOrder.remaining_usdt), 50, 'Backfilled hold should match ad escrow amount');

  console.log('[test-escrow-hold-backfill] Confirming payment and releasing...');
  await confirmMmkTransfer(order.id, buyer.id, {
    proofPath: '/uploads/p2p/mock_receipt.jpg',
    proofOriginalName: 'receipt.jpg',
    proofMimeType: 'image/jpeg',
  });

  const releaseResult = await releaseP2pBuyOrderByMaker(order.id, seller.id);
  assert(releaseResult.order.status === 'released', 'Order should release successfully');

  const holdAfterRelease = await db.get(
    `SELECT * FROM usdt_escrow_holds WHERE reference_type = 'p2p_ads' AND reference_id = ?`,
    adId
  );
  assert.strictEqual(Number(holdAfterRelease.remaining_usdt), 30, 'Hold remaining should decrease after release');

  console.log('[test-escrow-hold-backfill] Cancelling legacy ad without escrow hold record...');
  const orphanAdId = await createLegacySellAdWithoutHold(db, seller.id, 25);
  await db.run(`UPDATE users SET balance_usdt_locked = 0 WHERE id = ?`, seller.id);
  const cancelResult = await cancelP2pAd(seller.id, orphanAdId);
  assert.strictEqual(cancelResult.ad.status, 'cancelled', 'Legacy ad cancel should succeed');
  assert.strictEqual(Number(cancelResult.ad.escrow_locked_usdt), 0, 'Ad escrow should be cleared');

  console.log('========================================');
  console.log('ESCROW HOLD BACKFILL TEST PASSED');
  console.log('========================================');

  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
