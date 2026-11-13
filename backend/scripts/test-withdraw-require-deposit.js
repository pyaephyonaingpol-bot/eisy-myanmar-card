#!/usr/bin/env node
/**
 * USDT withdrawal requires verified deposit history.
 * Run: node backend/scripts/test-withdraw-require-deposit.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

const dbPath = path.join(os.tmpdir(), `eisy-withdraw-deposit-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-withdraw-deposit-secret';

const { initDb, getDb } = require('../src/db');

(async () => {
  await initDb();

  const User = require('../src/models/User');
  const DepositRequest = require('../src/models/DepositRequest');
  const {
    assertDepositHistoryForWithdrawal,
    DEPOSIT_HISTORY_REQUIRED_MESSAGE,
    createUsdtWithdrawalRequest,
  } = require('../src/services/withdrawalService');

  assert.strictEqual(
    DEPOSIT_HISTORY_REQUIRED_MESSAGE,
    'Withdrawal not allowed. Deposit history is required before making a withdrawal.'
  );

  const user = await User.create({
    email: 'nodeposit@gmail.com',
    name: 'No Deposit',
    phone: `+959${String(Date.now()).slice(-8)}`,
  });
  const db = getDb();
  await db.run('UPDATE users SET balance_usdt = 100 WHERE id = ?', user.id);

  assert.strictEqual(await DepositRequest.hasVerifiedUsdtDeposit(user.id), false);
  await assert.rejects(
    () => assertDepositHistoryForWithdrawal(user.id),
    (err) => (
      err.code === 'DEPOSIT_HISTORY_REQUIRED'
      && err.message === DEPOSIT_HISTORY_REQUIRED_MESSAGE
      && err.status === 403
    )
  );

  await assert.rejects(
    () => createUsdtWithdrawalRequest(user.id, {
      network: 'TRC20',
      wallet_address: 'TXYZabcdefghijklmnopqrstuvwxyz123456',
      amount_usdt: 20,
    }),
    (err) => err.code === 'DEPOSIT_HISTORY_REQUIRED'
  );

  // Pending deposit does not unlock withdrawal
  const pending = await DepositRequest.create({
    userId: user.id,
    amountMmk: 0,
    amountUsd: 25,
    refCode: `DEP-PEND-${Date.now()}`,
    paymentMethod: 'USDT_TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
  });
  assert.strictEqual(await DepositRequest.hasVerifiedUsdtDeposit(user.id), false);

  // Card-issuance VERIFIED (no wallet credit) does not unlock
  await db.run(
    `UPDATE deposit_requests_v2
     SET status = 'VERIFIED', purpose = 'card_issuance', verified_at = datetime('now')
     WHERE id = ?`,
    pending.id
  );
  assert.strictEqual(await DepositRequest.hasVerifiedUsdtDeposit(user.id), false);

  // Real verified USDT top-up unlocks
  const topup = await DepositRequest.create({
    userId: user.id,
    amountMmk: 0,
    amountUsd: 30,
    refCode: `DEP-OK-${Date.now()}`,
    paymentMethod: 'USDT_TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
  });
  await db.run(
    `UPDATE deposit_requests_v2
     SET status = 'VERIFIED', verified_at = datetime('now')
     WHERE id = ?`,
    topup.id
  );
  assert.strictEqual(await DepositRequest.hasVerifiedUsdtDeposit(user.id), true);
  await assertDepositHistoryForWithdrawal(user.id);

  const svcSrc = fs.readFileSync(path.join(__dirname, '../src/services/withdrawalService.js'), 'utf8');
  assert.ok(svcSrc.includes('assertDepositHistoryForWithdrawal(userId)'));
  assert.ok(svcSrc.includes('DEPOSIT_HISTORY_REQUIRED'));

  const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/withdrawal.js'), 'utf8');
  assert.ok(routeSrc.includes('DEPOSIT_HISTORY_REQUIRED'));

  console.log('test-withdraw-require-deposit: OK');
  process.exit(0);
})().catch((err) => {
  console.error('test-withdraw-require-deposit: FAIL', err);
  process.exit(1);
});
