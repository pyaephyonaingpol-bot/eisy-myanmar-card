#!/usr/bin/env node
/**
 * Regression: conditional USDT debit must prevent concurrent overdrafts.
 *
 * Covers:
 * - Source wiring (UPDATE ... WHERE balance >= amount)
 * - Single debit + insufficient error shape/code
 * - Concurrent debitAvailable races that previously overdrafted via SELECT-then-SET
 * - walletService.debitUsdt still routes through debitAvailable
 *
 * Run: node backend/scripts/test-conditional-usdt-debit.js
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

async function balanceOf(db, userId) {
  const row = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row?.balance_usdt ?? 0);
}

async function main() {
  section('Source: conditional debit / lock helpers');
  const ledgerSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/usdtLedgerService.js'),
    'utf8'
  );
  assert.ok(ledgerSrc.includes('async function applyAvailableDebitAtomic'), 'debit helper');
  assert.ok(ledgerSrc.includes('async function applyAvailableLockAtomic'), 'lock helper');
  assert.ok(
    /COALESCE\(balance_usdt,\s*0\)\s*>=\s*\?/.test(ledgerSrc),
    'conditional WHERE balance >= amount'
  );
  assert.ok(
    ledgerSrc.includes('await applyAvailableDebitAtomic(db, userId, amount'),
    'debitAvailable uses atomic helper'
  );

  const walletSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/walletService.js'),
    'utf8'
  );
  assert.ok(
    walletSrc.includes("require('./usdtLedgerService')")
      && walletSrc.includes('debitAvailable'),
    'walletService.debitUsdt delegates to debitAvailable'
  );
  console.log('ok');

  const dbFile = path.join(os.tmpdir(), `eisy-conditional-debit-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    debitAvailable,
    creditAvailable,
    applyAvailableDebitAtomic,
    withDbTransaction,
  } = require('../src/services/usdtLedgerService');
  const { debitUsdt } = require('../src/services/walletService');

  await initDb();
  const db = getDb();
  const stamp = Date.now();

  section('Insufficient debit keeps balance and error code');
  const shortIns = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, balance_usdt_locked)
     VALUES (?, ?, ?, 10, 2)`,
    'Short Wallet',
    `091${String(stamp).slice(-8)}`,
    `short-${stamp}@example.com`
  );
  const shortId = Number(shortIns.lastID);

  await assert.rejects(
    () => debitAvailable(shortId, 10.01, {
      txType: 'balance_debit',
      referenceType: 'test',
      referenceId: shortId,
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE'
      && err.required_usdt === 10.01
      && Number(err.available_usdt) === 10
  );
  assert.strictEqual(await balanceOf(db, shortId), 10);

  const ledgerCount = await db.get(
    `SELECT COUNT(*) AS c FROM usdt_wallet_transactions WHERE user_id = ?`,
    shortId
  );
  assert.strictEqual(Number(ledgerCount.c), 0, 'failed debit must not write ledger');
  console.log('ok');

  section('Successful debit writes ledger + leaves locked untouched');
  await debitAvailable(shortId, 4, {
    txType: 'balance_debit',
    referenceType: 'test',
    referenceId: 1001,
    description: 'test debit 4',
  });
  assert.strictEqual(await balanceOf(db, shortId), 6);
  const locked = await db.get(
    'SELECT balance_usdt_locked FROM users WHERE id = ?',
    shortId
  );
  assert.strictEqual(Number(locked.balance_usdt_locked), 2);

  const entry = await db.get(
    `SELECT * FROM usdt_wallet_transactions
     WHERE user_id = ? AND reference_type = 'test' AND reference_id = 1001`,
    shortId
  );
  assert.ok(entry, 'ledger row written');
  assert.strictEqual(entry.direction, 'debit');
  assert.strictEqual(Number(entry.amount_usdt), 4);
  assert.strictEqual(Number(entry.balance_before), 10);
  assert.strictEqual(Number(entry.balance_after), 6);
  console.log('ok');

  section('walletService.debitUsdt uses the same path');
  await debitUsdt(shortId, 1, {
    txType: 'balance_debit',
    referenceType: 'test',
    referenceId: 1002,
  });
  assert.strictEqual(await balanceOf(db, shortId), 5);
  console.log('ok');

  section('Stale-read race: conditional UPDATE rejects second debit');
  const raceIns = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt, balance_usdt_locked)
     VALUES (?, ?, ?, 100, 0)`,
    'Race Wallet',
    `092${String(stamp).slice(-8)}`,
    `race-${stamp}@example.com`
  );
  const raceId = Number(raceIns.lastID);

  // Simulate the classic SELECT-then-SET race: after a first debit wins,
  // a second conditional UPDATE for 80 against remaining 20 must fail.
  await debitAvailable(raceId, 80, {
    txType: 'balance_debit',
    referenceType: 'race',
    referenceId: 1,
  });
  assert.strictEqual(await balanceOf(db, raceId), 20);

  await assert.rejects(
    () => debitAvailable(raceId, 80, {
      txType: 'balance_debit',
      referenceType: 'race',
      referenceId: 2,
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE'
      && Number(err.available_usdt) === 20
  );
  assert.strictEqual(await balanceOf(db, raceId), 20);

  // Direct SQL: absolute SET would overdraft; conditional WHERE must not.
  await db.run('UPDATE users SET balance_usdt = 100 WHERE id = ?', raceId);
  await withDbTransaction(async (txnDb) => {
    await applyAvailableDebitAtomic(txnDb, raceId, 60);
  });
  assert.strictEqual(await balanceOf(db, raceId), 40);
  await assert.rejects(
    () => withDbTransaction(async (txnDb) => {
      await applyAvailableDebitAtomic(txnDb, raceId, 60);
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE'
  );
  assert.strictEqual(await balanceOf(db, raceId), 40);

  const raceLedger = await db.get(
    `SELECT COUNT(*) AS c FROM usdt_wallet_transactions
     WHERE user_id = ? AND reference_type = 'race'`,
    raceId
  );
  assert.strictEqual(Number(raceLedger.c), 1, 'only winning debit writes a ledger row');
  console.log('ok');

  section('Sequential burst of overlapping debits stays non-negative');
  // Shared LibSQL adapter is single-connection; drive a burst of overlapping
  // amounts sequentially so the conditional UPDATE (not Promise racing) is
  // what rejects the overdraft. Multi-instance Turso races use the same SQL.
  const manyIns = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 50)`,
    'Many Debits',
    `093${String(stamp).slice(-8)}`,
    `many-${stamp}@example.com`
  );
  const manyId = Number(manyIns.lastID);

  let wins = 0;
  let losses = 0;
  for (let i = 0; i < 20; i += 1) {
    try {
      await debitAvailable(manyId, 10, {
        txType: 'balance_debit',
        referenceType: 'many',
        referenceId: i + 1,
      });
      wins += 1;
    } catch (err) {
      assert.strictEqual(err.code, 'INSUFFICIENT_USDT_BALANCE');
      losses += 1;
    }
  }
  assert.strictEqual(wins, 5, `expected 5 wins, got ${wins}`);
  assert.strictEqual(losses, 15, `expected 15 losses, got ${losses}`);
  assert.strictEqual(await balanceOf(db, manyId), 0);
  console.log('ok');

  section('applyAvailableDebitAtomic inside explicit transaction');
  await creditAvailable(shortId, 3, {
    txType: 'balance_credit',
    referenceType: 'test',
    referenceId: 2001,
  });
  const before = await balanceOf(db, shortId);
  await withDbTransaction(async (txnDb) => {
    const applied = await applyAvailableDebitAtomic(txnDb, shortId, 2);
    assert.strictEqual(applied.availableBefore, before);
    assert.strictEqual(applied.availableAfter, before - 2);
  });
  assert.strictEqual(await balanceOf(db, shortId), before - 2);
  console.log('ok');

  console.log('\nconditional-usdt-debit: ok');
  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
}

main().catch(async (err) => {
  console.error('conditional-usdt-debit: FAIL', err);
  try {
    const { closeDb } = require('../src/db');
    await closeDb();
  } catch (_) { /* ignore */ }
  process.exit(1);
});
