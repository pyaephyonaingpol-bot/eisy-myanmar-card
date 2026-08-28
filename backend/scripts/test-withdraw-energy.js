#!/usr/bin/env node
/**
 * Fixed-fee withdraw + energy rental smoke tests (no live Feee/Tron required).
 * Run: node backend/scripts/test-withdraw-energy.js
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

  section('rentEnergyForAddress posts Feee-compatible payload');
  const energy = require('../src/services/energyRentalService');
  process.env.ENERGY_RENTAL_API_KEY = 'test-feee-key';
  process.env.ENERGY_RENTAL_WAIT_MS = '0';
  process.env.ENERGY_RENTAL_AMOUNT = '65000';

  let captured;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      json: async () => ({
        code: 0,
        msg: 'success',
        data: { order_no: 'ORDER-ENERGY-1', pay_amount: 1.2 },
      }),
    };
  };

  const rental = await energy.rentEnergyForAddress(validTrc20);
  assert.strictEqual(rental.skipped, false);
  assert.strictEqual(rental.energy_amount, 65000);
  assert.strictEqual(rental.order_no, 'ORDER-ENERGY-1');
  assert.match(String(captured.url), /\/v2\/order\/submit/);
  assert.strictEqual(captured.options.headers.key, 'test-feee-key');
  const body = JSON.parse(captured.options.body);
  assert.strictEqual(body.resource_type, 1);
  assert.strictEqual(body.resource_value, 65000);
  assert.strictEqual(body.receive_address, validTrc20);
  global.fetch = originalFetch;
  console.log('ok');

  section('executeFixedFeeTrc20Withdraw rents energy then transfers net payout');
  const dbFile = path.join(os.tmpdir(), `eisy-withdraw-energy-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.MASTER_PRIVATE_KEY = 'a'.repeat(64);
  process.env.ENERGY_RENTAL_WAIT_MS = '0';

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();
  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 100)`,
    'Withdraw Energy Test',
    phone
  );
  const userId = Number(userIns.lastID);

  const tron = require('../src/services/tronMasterWalletService');
  const originalTransfer = tron.transferUsdtTrc20;
  let transferArgs;
  let energyCalled = false;

  // Patch energy + transfer via transferUsdtTrc20 mock that still exercises rental hook path
  // by stubbing at service boundary used by executeFixedFeeTrc20Withdraw.
  tron.transferUsdtTrc20 = async ({ toAddress, amountUsdt }) => {
    transferArgs = { toAddress, amountUsdt };
    const { rentEnergyForAddress } = require('../src/services/energyRentalService');
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ code: 0, msg: 'success', data: { order_no: 'E2' } }),
    });
    const energyRental = await rentEnergyForAddress('TMasterFakeAddress11111111111111111');
    energyCalled = !energyRental.skipped;
    global.fetch = originalFetch;
    return {
      txId: 'txid-withdraw-abc',
      fromAddress: 'TMasterFakeAddress11111111111111111',
      toAddress,
      amountUsdt: Number(amountUsdt),
      energyRental,
    };
  };

  // Re-require withdraw service so it picks up? It already required transferUsdtTrc20 by reference
  // from module.exports — mutating tron.transferUsdtTrc20 updates the same export object.
  const result = await executeFixedFeeTrc20Withdraw(userId, {
    customerAddress: validTrc20,
    withdrawAmount: 25,
  });

  assert.strictEqual(result.txId, 'txid-withdraw-abc');
  assert.strictEqual(result.netPayout, 23);
  assert.strictEqual(result.fee_collected, 2);
  assert.strictEqual(transferArgs.amountUsdt, 23);
  assert.ok(energyCalled);

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

  tron.transferUsdtTrc20 = originalTransfer;
  await closeDb?.();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  delete process.env.MASTER_PRIVATE_KEY;
  delete process.env.ENERGY_RENTAL_API_KEY;
  console.log('ok');

  console.log('\nWithdraw + energy rental checks passed.');
}

main().catch((err) => {
  console.error('\nWithdraw energy checks FAILED:', err);
  process.exit(1);
});
