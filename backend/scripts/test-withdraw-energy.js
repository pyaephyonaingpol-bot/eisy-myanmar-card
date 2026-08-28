#!/usr/bin/env node
/**
 * Fixed-fee withdraw smoke tests (no live Tron / energy APIs).
 * Run: node backend/scripts/test-withdraw-energy.js
 * (script name kept for npm compatibility; energy rental is no longer used)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  // Valid Base58Check TRON address (derived from a dummy key — not a real wallet in use).
  const validTrc20 = 'TNTU3x2BLuJg3MQCnk6hne43NpgphMK2NJ';

  section('calculateFixedFeeWithdraw');
  const {
    calculateFixedFeeWithdraw,
    executeFixedFeeTrc20Withdraw,
  } = require('../src/services/withdrawCryptoService');

  const ok = calculateFixedFeeWithdraw({
    customerAddress: validTrc20,
    withdrawAmount: 25,
  });
  assert.strictEqual(ok.feeUsdt, 2);
  assert.strictEqual(ok.netPayout, 23);
  assert.strictEqual(ok.withdrawAmount, 25);

  assert.throws(
    () => calculateFixedFeeWithdraw({
      customerAddress: validTrc20,
      withdrawAmount: 2,
    }),
    (err) => err.code === 'WITHDRAW_AMOUNT_TOO_LOW'
  );
  assert.throws(
    () => calculateFixedFeeWithdraw({
      customerAddress: 'not-a-tron-address',
      withdrawAmount: 10,
    }),
    (err) => err.code === 'WITHDRAW_ADDRESS_INVALID'
  );
  // Regex-shaped but checksum-invalid
  assert.throws(
    () => calculateFixedFeeWithdraw({
      customerAddress: 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH',
      withdrawAmount: 10,
    }),
    (err) => err.code === 'WITHDRAW_ADDRESS_INVALID'
  );
  console.log('ok');

  section('executeFixedFeeTrc20Withdraw transfers net payout (no energy rental)');
  const dbFile = path.join(os.tmpdir(), `eisy-withdraw-manual-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.MASTER_PRIVATE_KEY = 'a'.repeat(64);

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();
  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 100)`,
    'Withdraw Manual Energy Test',
    phone
  );
  const userId = Number(userIns.lastID);

  const tron = require('../src/services/tronMasterWalletService');
  const originalTransfer = tron.transferUsdtTrc20;
  let transferArgs;

  tron.transferUsdtTrc20 = async ({ toAddress, amountUsdt }) => {
    transferArgs = { toAddress, amountUsdt };
    return {
      txId: 'txid-withdraw-abc',
      fromAddress: 'TP5gxuZj6Pj5ciM6B8fMJwytZwWAJ66sat',
      toAddress,
      amountUsdt: Number(amountUsdt),
    };
  };

  const result = await executeFixedFeeTrc20Withdraw(userId, {
    customerAddress: validTrc20,
    withdrawAmount: 25,
  });

  assert.strictEqual(result.txId, 'txid-withdraw-abc');
  assert.strictEqual(result.netPayout, 23);
  assert.strictEqual(result.fee_collected, 2);
  assert.strictEqual(transferArgs.amountUsdt, 23);
  assert.strictEqual(transferArgs.toAddress, validTrc20);
  assert.strictEqual(result.energyRental, undefined);

  const user = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.strictEqual(Number(user.balance_usdt), 75);

  const row = await db.get(
    'SELECT * FROM usdt_withdrawal_requests WHERE id = ?',
    result.withdrawal.id
  );
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.tx_hash, 'txid-withdraw-abc');
  assert.strictEqual(Number(row.net_usdt), 23);
  assert.strictEqual(Number(row.fee_usdt), 2);
  assert.match(String(row.admin_note || ''), /master wallet/i);
  assert.doesNotMatch(String(row.admin_note || ''), /energy rental/i);

  tron.transferUsdtTrc20 = originalTransfer;
  await closeDb?.();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  delete process.env.MASTER_PRIVATE_KEY;
  console.log('ok');

  // Guard: energy rental module must not exist / not be required by transfer path.
  section('no Feee energy rental module');
  assert.throws(
    () => require('../src/services/energyRentalService'),
    (err) => err.code === 'MODULE_NOT_FOUND'
  );
  const transferSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/tronMasterWalletService.js'),
    'utf8'
  );
  assert.doesNotMatch(transferSrc, /energyRentalService|rentEnergyForAddress|Feee\.io/);
  console.log('ok');

  console.log('\nFixed-fee withdraw (manual energy) checks passed.');
}

main().catch((err) => {
  console.error('\nWithdraw checks FAILED:', err);
  process.exit(1);
});
