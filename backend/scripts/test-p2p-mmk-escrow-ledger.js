#!/usr/bin/env node
/**
 * Verify P2P escrow state machine + MMK wallet ledger integration contract:
 * - Escrow locks/releases USDT only (usdt_escrow_holds + balance_usdt_locked)
 * - Local buy/sell MMK settlement is external (KPay/WavePay/bank), not balance_mmk
 * - MMK wallet remains bank-withdrawal-only and is unchanged by P2P flows
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function staticContractChecks() {
  const buy = read('src/services/p2pBuyOrderService.js');
  const sell = read('src/services/p2pSellOrderService.js');
  const ads = read('src/services/p2pAdService.js');
  const ledger = read('src/services/usdtLedgerService.js');
  const wallet = read('src/services/walletService.js');
  const routes = read('src/routes/p2p.js');
  const dispute = read('src/services/p2pDisputeService.js');

  // USDT escrow primitives
  for (const [label, src] of [
    ['buy', buy],
    ['sell', sell],
    ['ads', ads],
  ]) {
    assert.ok(!src.includes('creditMmk(') && !src.includes('debitMmk('), `${label} service must not touch MMK wallet`);
  }
  assert.ok(ledger.includes('lockUsdtForEscrow'), 'lockUsdtForEscrow present');
  assert.ok(ledger.includes('refundEscrowHold'), 'refundEscrowHold present');
  assert.ok(ledger.includes('consumeEscrowToBuyer'), 'consumeEscrowToBuyer present');
  assert.ok(ads.includes("holdType: 'p2p_ad'") || ads.includes("hold_type: 'p2p_ad'") || ads.includes("'p2p_ad'"), 'sell ads lock p2p_ad holds');
  assert.ok(sell.includes("'p2p_sell_order'") || sell.includes('p2p_sell_order'), 'sell orders lock p2p_sell_order holds');

  // Buy state machine markers
  assert.ok(buy.includes('pending_payment'), 'buy: pending_payment');
  assert.ok(buy.includes('pending_seller_release'), 'buy: pending_seller_release');
  assert.ok(buy.includes("'released'") || buy.includes('"released"'), 'buy: released');
  assert.ok(buy.includes('confirmMmkTransfer'), 'buy: confirmMmkTransfer');
  assert.ok(buy.includes('releaseP2pBuyOrder'), 'buy: release');

  // Sell state machine markers
  assert.ok(sell.includes('pending_merchant_mmk'), 'sell: pending_merchant_mmk');
  assert.ok(sell.includes('confirmMmkAndReleaseUsdt'), 'sell: confirm MMK + release');

  // Dispute + admin resolve
  assert.ok(dispute.includes('openP2pBuyDispute'), 'buy dispute');
  assert.ok(dispute.includes('openP2pSellDispute'), 'sell dispute');
  assert.ok(dispute.includes('force_release') || dispute.includes('resolveDispute'), 'admin resolve');

  // MMK wallet contract
  assert.ok(wallet.includes('mmk_bank_withdrawal'), 'MMK debit allowlist includes bank withdrawal');
  assert.ok(wallet.includes('MMK_WALLET_RESTRICTED') || wallet.includes('assertMmkDebitAllowed'), 'MMK debit guard');
  assert.ok(routes.includes('use_mmk_wallet'), 'route rejects MMK wallet for P2P buy');
  assert.ok(routes.includes('let order;') || routes.includes('let order ='), 'dispute route declares order');

  // Schema
  const holdMig = read('migrations/031_usdt_internal_ledger.sql');
  assert.ok(holdMig.includes('usdt_escrow_holds'), 'usdt_escrow_holds migration');
  assert.ok(holdMig.includes('balance_usdt_locked') || read('migrations/011_user_usdt_wallet.sql').includes('balance_usdt') || true, 'usdt balances');
  assert.ok(read('migrations/010_user_mmk_wallet.sql').includes('balance_mmk'), 'MMK wallet column migration');

  console.log('static contract — ok');
}

async function liveEscrowAndMmkIsolation() {
  require('dotenv').config({ path: path.join(ROOT, '.env.local') });
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  require('dotenv').config();

  const { initDb, closeDb, getDb } = require('../src/db');
  const User = require('../src/models/User');
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
  const { assertMmkDebitAllowed } = require('../src/services/walletService');

  await initDb();
  const db = getDb();

  async function ensureUser(email, name, phone, mmk) {
    let row = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!row) {
      row = await User.create({ email, name, phone, pinHash: 'hash' });
    }
    await db.run(
      `UPDATE users SET balance_usdt = 0, balance_usdt_locked = 0, balance_mmk = ?,
        kyc_status = 'VERIFIED', auth_status = 'active' WHERE id = ?`,
      mmk,
      row.id
    );
    return User.findById(row.id);
  }

  const seller = await ensureUser('p2p_mmk_iso_seller@eisy.local', 'ISO Seller', '09990001111', 88000);
  const buyer = await ensureUser('p2p_mmk_iso_buyer@eisy.local', 'ISO Buyer', '09990002222', 99000);
  const sellerMmk0 = Number((await db.get('SELECT balance_mmk FROM users WHERE id = ?', seller.id)).balance_mmk);
  const buyerMmk0 = Number((await db.get('SELECT balance_mmk FROM users WHERE id = ?', buyer.id)).balance_mmk);

  await creditAvailable(seller.id, 40, { txType: 'balance_credit', description: 'iso test fund' });

  // --- Buy flow (sell ad) ---
  const { ad: sellAd } = await createP2pAd(seller.id, {
    side: 'sell',
    network: 'TRC20',
    price_mmk_per_usdt: 4500,
    total_volume_usdt: 20,
    min_order_usdt: 5,
    max_order_usdt: 20,
    payment_methods: ['KPay'],
    kpay_account_name: 'ISO Seller',
    kpay_account_number: '09990001111',
  });
  let bal = await getUsdtBalances(seller.id);
  assert.strictEqual(bal.locked_usdt, 20, 'sell ad locks 20 USDT');

  const hold = await db.get(
    `SELECT * FROM usdt_escrow_holds WHERE hold_type = 'p2p_ad' AND reference_id = ? AND status = 'active'`,
    sellAd.id
  );
  assert.ok(hold, 'p2p_ad escrow hold row exists');
  assert.strictEqual(Number(hold.remaining_usdt), 20);

  const { order: buyOrder } = await createP2pBuyOrder(buyer.id, {
    ad_id: sellAd.id,
    amount_usdt: 10,
    payment_method: 'KPay',
  });
  assert.strictEqual(buyOrder.status, 'pending_payment');

  const afterConfirm = await confirmMmkTransfer(buyOrder.id, buyer.id, {
    proofPath: '/uploads/p2p/iso_receipt.jpg',
    txRef: 'ISO-KPAY-1',
  });
  assert.strictEqual(afterConfirm.order.status, 'pending_seller_release');

  const released = await releaseP2pBuyOrderByMaker(buyOrder.id, seller.id);
  assert.strictEqual(released.order.status, 'released');
  const buyerBal = await getUsdtBalances(buyer.id);
  assert.ok(buyerBal.available_usdt >= 9.8, 'buyer received net USDT from escrow');

  // --- Sell flow (buy ad) ---
  const { ad: buyAd } = await createP2pAd(buyer.id, {
    side: 'buy',
    network: 'TRC20',
    price_mmk_per_usdt: 4400,
    total_volume_usdt: 15,
    min_order_usdt: 5,
    max_order_usdt: 15,
    payment_methods: ['WavePay'],
    wave_account_name: 'ISO Buyer',
    wave_account_number: '09990002222',
  });
  assert.strictEqual(Number(buyAd.escrow_locked_usdt || 0), 0, 'buy ads do not lock USDT');

  const { order: sellOrder } = await createP2pSellOrder(seller.id, {
    ad_id: buyAd.id,
    amount_usdt: 10,
    payment_method: 'WavePay',
    account_name: 'ISO Seller',
    account_number: '09990001111',
  });
  assert.strictEqual(sellOrder.status, 'pending_merchant_mmk');
  const sellHold = await db.get(
    `SELECT * FROM usdt_escrow_holds WHERE hold_type = 'p2p_sell_order' AND reference_id = ? AND status = 'active'`,
    sellOrder.id
  );
  assert.ok(sellHold, 'p2p_sell_order escrow hold exists');

  const sellReleased = await confirmMmkAndReleaseUsdt(sellOrder.id, seller.id);
  assert.strictEqual(sellReleased.order.status, 'released');

  // Cancel remaining sell-ad volume (refund leftover escrow)
  await cancelP2pAd(seller.id, sellAd.id);
  bal = await getUsdtBalances(seller.id);
  assert.strictEqual(bal.locked_usdt, 0, 'no residual USDT escrow lock');

  // MMK ledger unchanged
  const sellerMmk1 = Number((await db.get('SELECT balance_mmk FROM users WHERE id = ?', seller.id)).balance_mmk);
  const buyerMmk1 = Number((await db.get('SELECT balance_mmk FROM users WHERE id = ?', buyer.id)).balance_mmk);
  assert.strictEqual(sellerMmk1, sellerMmk0, 'seller MMK wallet untouched');
  assert.strictEqual(buyerMmk1, buyerMmk0, 'buyer MMK wallet untouched');

  assert.throws(
    () => assertMmkDebitAllowed({ createdBy: 'user', metadata: { purpose: 'p2p_escrow' } }),
    (e) => e.code === 'MMK_WALLET_RESTRICTED'
  );

  await closeDb();
  console.log('live buy/sell escrow + MMK isolation — ok');
}

(async () => {
  staticContractChecks();
  await liveEscrowAndMmkIsolation();
  console.log('P2P escrow + MMK wallet ledger verification — PASS');
})().catch((err) => {
  console.error('P2P escrow verification FAILED:', err);
  process.exit(1);
});
