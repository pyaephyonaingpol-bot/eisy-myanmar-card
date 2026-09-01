#!/usr/bin/env node
/**
 * Deposit profit tracking + revenue dashboard regression.
 * Run: node backend/scripts/test-deposit-profit-tracking.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-deposit-profit-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.MASTER_WALLET_ADDRESS = process.env.MASTER_WALLET_ADDRESS || 'TTestMasterWalletAddress123456789012';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const { creditDepositAndVerify } = require('../src/services/depositService');
  const { getRevenueDashboard } = require('../src/services/revenueAnalyticsService');
  const PlatformFeeEvent = require('../src/models/PlatformFeeEvent');
  const { PLATFORM_FEE_TYPES } = require('../src/constants/platformFeeTypes');

  await initDb();
  const db = getDb();

  const user = await db.run(
    `INSERT INTO users (name, phone, balance_mmk, balance_usdt) VALUES (?, ?, 0, 0)`,
    'Profit Test',
    `09${String(Date.now()).slice(-8)}`
  );
  const userId = Number(user.lastID);

  const DepositRequest = require('../src/models/DepositRequest');
  const refCode = `REF-PROFIT-${Date.now()}`;
  const deposit = await DepositRequest.create({
    userId,
    amountMmk: 0,
    amountUsd: 100,
    refCode,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    platformProfitUsd: 2,
    metadata: {
      payment_fee: { platform_profit_usd: 2, fee_usdt: 2, net_usdt: 98 },
      pricing: { platform_profit_usd: 2, fee_usdt: 2, net_usdt: 98 },
    },
  });
  const meta = typeof deposit.metadata === 'string' ? JSON.parse(deposit.metadata) : (deposit.metadata || {});
  const profitUsd = Number(deposit.platform_profit_usd || meta?.payment_fee?.platform_profit_usd || 0);
  assert.ok(profitUsd > 0, 'platform profit should be stored on USDT deposit row or metadata');

  const verified = await creditDepositAndVerify(deposit, {
    txnId: `TX-${Date.now()}`,
    createdBy: 'admin',
    adminNote: 'verified in test',
    reviewedByAdminId: 1,
  });
  assert.strictEqual(verified.alreadyVerified, false);

  const refreshed = await db.get(
    `SELECT platform_profit_usd, status FROM deposit_requests_v2 WHERE id = ?`,
    deposit.id
  );
  assert.strictEqual(refreshed.status, 'VERIFIED');
  assert.ok(Number(refreshed.platform_profit_usd) > 0, 'verified deposit keeps profit column');

  const feeEvent = await PlatformFeeEvent.findByReference('deposit_requests_v2', deposit.id);
  assert.ok(feeEvent, 'deposit verification should create a platform fee event');
  assert.strictEqual(feeEvent.fee_type, PLATFORM_FEE_TYPES.DEPOSIT);

  const dashboard = await getRevenueDashboard();
  assert.ok(Number(dashboard.summary.today_deposit_profit_usdt || 0) > 0, 'dashboard should include deposit fees');
  assert.ok(Number(dashboard.summary.all_time_deposit_profit_usdt || 0) > 0, 'all-time deposit fees should be reported');
  assert.ok((dashboard.counts?.deposit_fee_events || 0) >= 1, 'deposit fee event count should be present');
  assert.ok((dashboard.daily_breakdown || []).some((row) => Number(row.deposit_fees_usd || 0) > 0), 'daily rows should include deposit fees');

  await closeDb().catch(() => {});
  console.log('test-deposit-profit-tracking: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
