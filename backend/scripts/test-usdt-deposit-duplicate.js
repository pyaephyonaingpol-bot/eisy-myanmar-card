#!/usr/bin/env node
/**
 * Regression checks for USDT deposit duplicate-submit protection.
 * Run: node backend/scripts/test-usdt-deposit-duplicate.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  assertNoRapidDuplicateUsdtDeposit,
  getUsdtDepositDuplicateWindowSec,
  amountsMatchUsdt,
  createUsdtDepositRequest,
} = require('../src/services/depositService');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('Duplicate window defaults');
  const prevWindow = process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC;
  delete process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC;
  assert.strictEqual(getUsdtDepositDuplicateWindowSec(), 90);
  process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC = '0';
  assert.strictEqual(getUsdtDepositDuplicateWindowSec(), 0);
  process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC = '120';
  assert.strictEqual(getUsdtDepositDuplicateWindowSec(), 120);
  if (prevWindow === undefined) delete process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC;
  else process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC = prevWindow;
  assert.ok(amountsMatchUsdt(50, 50));
  assert.ok(amountsMatchUsdt(50.001, 50));
  assert.ok(!amountsMatchUsdt(51, 50));
  console.log('ok');

  section('Rapid same-amount create is rejected');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC = '90';
  process.env.MASTER_WALLET_ADDRESS = process.env.MASTER_WALLET_ADDRESS
    || 'TXYZabcdefghijklmnopqrstuvwxyz1234';
  process.env.USDT_TRC20_ADDRESS = process.env.USDT_TRC20_ADDRESS
    || process.env.MASTER_WALLET_ADDRESS;

  const { initDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone) VALUES (?, ?)`,
    'Dup Deposit Test',
    phone
  );
  const userId = Number(userIns.lastID);

  // Ensure settings expose a TRC20 address via card pricing (fallback path).
  try {
    await db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('usdt_trc20_address', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      process.env.MASTER_WALLET_ADDRESS
    );
  } catch (_) {
    try {
      await db.run(
        `UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = 'usdt_trc20_address'`,
        process.env.MASTER_WALLET_ADDRESS
      );
    } catch (__) { /* createUsdtDepositRequest has other fallbacks */ }
  }

  const first = await createUsdtDepositRequest(userId, {
    amount_usdt: 25.5,
    network: 'TRC20',
    metadata: { deposit_channel: 'platform_direct', test: true },
  });
  assert.ok(first.deposit?.id, 'first deposit should create');

  let rejected = false;
  try {
    await createUsdtDepositRequest(userId, {
      amount_usdt: 25.5,
      network: 'TRC20',
      metadata: { deposit_channel: 'platform_direct', test: true },
    });
  } catch (err) {
    rejected = true;
    assert.strictEqual(err.code, 'DUPLICATE_DEPOSIT_REQUEST');
    assert.ok(err.existing?.ref_code);
  }
  assert.ok(rejected, 'second identical create must be rejected');

  // Different amount within window is allowed
  const other = await createUsdtDepositRequest(userId, {
    amount_usdt: 30,
    network: 'TRC20',
    metadata: { deposit_channel: 'platform_direct', test: true },
  });
  assert.ok(other.deposit?.id);

  section('Rapid same TxID submit is rejected across deposits');
  const hash = `dup_tx_${Date.now()}_abc`;
  await db.run(
    `UPDATE deposit_requests_v2
     SET tx_hash = ?, txn_id = ?, kpay_transaction_id = ?, status = 'SUBMITTED',
         submitted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    hash, hash, hash, first.deposit.id
  );

  let txRejected = false;
  try {
    await assertNoRapidDuplicateUsdtDeposit(userId, {
      txHash: hash,
      excludeDepositId: other.deposit.id,
    });
  } catch (err) {
    txRejected = true;
    assert.strictEqual(err.code, 'DUPLICATE_DEPOSIT_REQUEST');
  }
  assert.ok(txRejected, 'same TxID on another deposit must be rejected');

  // Same deposit may keep using its own TxID (retry path)
  await assertNoRapidDuplicateUsdtDeposit(userId, {
    txHash: hash,
    excludeDepositId: first.deposit.id,
  });
  console.log('ok');

  await db.run(
    'DELETE FROM deposit_requests_v2 WHERE user_id = ?',
    userId
  );
  await db.run('DELETE FROM users WHERE id = ?', userId);

  if (prevWindow === undefined) delete process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC;
  else process.env.USDT_DEPOSIT_DUPLICATE_WINDOW_SEC = prevWindow;

  console.log('\nAll USDT deposit duplicate checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
