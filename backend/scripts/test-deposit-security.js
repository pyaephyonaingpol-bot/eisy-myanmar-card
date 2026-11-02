#!/usr/bin/env node
/**
 * Regression checks for deposit security hardening.
 * Run: node backend/scripts/test-deposit-security.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  verifyUsdtTransaction,
  amountWithinTolerance,
  isMockTxHash,
} = require('../src/services/usdtBlockchainService');
const { isUsdtVerificationBypassEnabled } = require('../src/services/depositService');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('BYPASS_USDT_TX_VERIFICATION defaults off');
  const prevBypass = process.env.BYPASS_USDT_TX_VERIFICATION;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.BYPASS_USDT_TX_VERIFICATION;
  process.env.NODE_ENV = 'production';
  assert.strictEqual(isUsdtVerificationBypassEnabled(), false, 'bypass must be off by default');

  process.env.BYPASS_USDT_TX_VERIFICATION = 'true';
  process.env.NODE_ENV = 'production';
  assert.strictEqual(
    isUsdtVerificationBypassEnabled(),
    false,
    'bypass must be refused in production even when env is true'
  );

  process.env.NODE_ENV = 'development';
  assert.strictEqual(
    isUsdtVerificationBypassEnabled(),
    true,
    'bypass may enable in non-production when explicitly set'
  );
  process.env.BYPASS_USDT_TX_VERIFICATION = 'false';
  assert.strictEqual(isUsdtVerificationBypassEnabled(), false);
  if (prevBypass === undefined) delete process.env.BYPASS_USDT_TX_VERIFICATION;
  else process.env.BYPASS_USDT_TX_VERIFICATION = prevBypass;
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
  console.log('ok');

  section('BEP20 verification is refused without a chain call');
  const bep = await verifyUsdtTransaction({
    network: 'BEP20',
    txHash: '0xabc123realhashnotmock',
    expectedAddress: '0x0000000000000000000000000000000000000001',
    expectedAmountUsdt: 10,
  });
  assert.strictEqual(bep.ok, false);
  assert.match(bep.message, /TRC20/);
  console.log('ok');

  section('Amount tolerance helper');
  assert.ok(amountWithinTolerance(10, 10));
  assert.ok(amountWithinTolerance(10.01, 10));
  assert.ok(!amountWithinTolerance(11, 10));
  console.log('ok');

  section('Mock tx hashes blocked in production path');
  assert.ok(isMockTxHash('11111'));
  assert.ok(isMockTxHash('test_tx_hash'));
  assert.ok(!isMockTxHash('0xabc123realhash'));
  console.log('ok');

  section('DB unique indexes + claimForCredit idempotency');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DATABASE_URL = `file:/tmp/eisy-deposit-sec-${Date.now()}.db`;
  delete process.env.TURSO_DATABASE_URL;
  const { initDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const indexes = await db.all(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'index'
      AND name IN (
        'idx_deposits_v2_tx_hash_unique',
        'idx_deposits_v2_txn_id_unique',
        'idx_deposits_v2_kpay_txn_unique'
      )
    ORDER BY name
  `);
  const names = indexes.map((r) => r.name);
  assert.ok(names.includes('idx_deposits_v2_tx_hash_unique'), 'tx_hash unique index missing');
  assert.ok(names.includes('idx_deposits_v2_txn_id_unique'), 'txn_id unique index missing');
  assert.ok(names.includes('idx_deposits_v2_kpay_txn_unique'), 'kpay_transaction_id unique index missing');
  console.log('unique indexes present:', names.join(', '));

  // Seed a user + deposit, then attempt duplicate tx_hash.
  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone) VALUES (?, ?)`,
    'Deposit Sec Test',
    phone
  );
  const userId = Number(userIns.lastID);

  const refA = `REF-SEC${Date.now().toString(16).slice(-6).toUpperCase()}A`;
  const refB = `REF-SEC${Date.now().toString(16).slice(-6).toUpperCase()}B`;
  const txHash = `sec_test_tx_${Date.now()}`;

  const insA = await db.run(`
    INSERT INTO deposit_requests_v2 (
      user_id, amount_mmk, amount_usd, ref_code, payment_method, purpose,
      status, deposit_currency, usdt_network, tx_hash
    ) VALUES (?, 0, 10, ?, 'USDT-TRC20', 'usdt_topup', 'SUBMITTED', 'USDT', 'TRC20', ?)
  `, userId, refA, txHash);
  const idA = Number(insA.lastID);

  let dupRejected = false;
  try {
    await db.run(`
      INSERT INTO deposit_requests_v2 (
        user_id, amount_mmk, amount_usd, ref_code, payment_method, purpose,
        status, deposit_currency, usdt_network, tx_hash
      ) VALUES (?, 0, 10, ?, 'USDT-TRC20', 'usdt_topup', 'SUBMITTED', 'USDT', 'TRC20', ?)
    `, userId, refB, txHash);
  } catch (err) {
    dupRejected = /UNIQUE|constraint/i.test(err.message);
  }
  assert.ok(dupRejected, 'duplicate tx_hash must violate unique index');
  console.log('duplicate tx_hash rejected');

  const DepositRequest = require('../src/models/DepositRequest');
  const first = await DepositRequest.claimForCredit(idA, {
    adminNote: 'security test claim',
    txnId: txHash,
    txHash,
  });
  assert.strictEqual(first, true, 'first claimForCredit should succeed');
  const second = await DepositRequest.claimForCredit(idA, {
    adminNote: 'security test claim again',
    txnId: txHash,
    txHash,
  });
  assert.strictEqual(second, false, 'second claimForCredit must be idempotent (no double credit)');
  console.log('claimForCredit idempotent');

  const { assertTxHashAvailable } = require('../src/services/depositService');
  let reuseBlocked = false;
  try {
    await assertTxHashAvailable(txHash, idA + 999);
  } catch (err) {
    reuseBlocked = err.code === 'TX_HASH_REUSED';
  }
  assert.ok(reuseBlocked, 'assertTxHashAvailable must block reused txid');
  console.log('assertTxHashAvailable blocks reuse');

  // Cleanup test rows
  await db.run('DELETE FROM deposit_requests_v2 WHERE id = ? OR ref_code IN (?, ?)', idA, refA, refB);
  await db.run('DELETE FROM users WHERE id = ?', userId);

  console.log('\nAll deposit security checks passed.');
}

main().catch((err) => {
  console.error('\nDeposit security checks FAILED:', err);
  process.exit(1);
});
