#!/usr/bin/env node
/**
 * Integration test: admin ledger USDT deposit / withdrawal list helpers + CSV.
 * Run: node backend/scripts/test-admin-usdt-tx-tabs.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-usdt-tx-tabs-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const {
    listUsdtDepositAdminTransactions,
    listUsdtWithdrawalAdminTransactions,
  } = require('../src/services/adminLedgerTransactionService');
  const { buildDailyTransactionsCsv } = require('../src/services/transactionCsvExportService');

  await initDb();
  const db = getDb();

  const user = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 100)`,
    'USDT Tab User',
    '0999888777',
    'usdt-tabs@example.com'
  );
  const userId = user.lastID;

  await db.run(
    `INSERT INTO user_usdt_wallet_addresses
      (user_id, network, address, address_type, derivation_path, derivation_index)
     VALUES (?, 'TRC20', ?, 'custodial', 'm/44''/195''/0''/0/7', 7)`,
    userId,
    'TCustodialDepositAddr1111111111111'
  );

  await db.run(
    `INSERT INTO deposit_requests_v2 (
      user_id, amount_usd, amount_mmk, ref_code, payment_method, deposit_currency,
      usdt_network, tx_hash, status, purpose, metadata, submitted_at, reviewed_at, created_at
    ) VALUES (?, 25.5, 0, 'DEP-USDT-1', 'USDT-TRC20', 'USDT', 'TRC20',
      '15e187bd8dbabcdef0123456789abcdef0123456789abcdef0123456789abcd',
      'VERIFIED', 'topup', ?, datetime('now'), datetime('now'), datetime('now'))`,
    userId,
    JSON.stringify({ tron_order_id: 'tron-ord-1' })
  );

  await db.run(
    `INSERT INTO usdt_withdrawal_requests (
      user_id, ref_code, payout_method, network, wallet_address,
      amount_usdt, fee_usdt, net_usdt, fee_type, status, tx_hash,
      processed_by, processed_at, created_at
    ) VALUES (?, 'WD-USDT-1', 'crypto', 'TRC20', 'TDestWalletAddr2222222222222222',
      8, 1, 7, 'fixed', 'completed',
      'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900',
      NULL, datetime('now'), datetime('now'))`,
    userId
  );

  const deposits = await listUsdtDepositAdminTransactions({ userId, limit: 50 });
  assert.ok(deposits.length >= 1, 'expected at least one USDT deposit');
  const dep = deposits.find((d) => d.ref_code === 'DEP-USDT-1');
  assert.ok(dep, 'DEP-USDT-1 missing');
  assert.strictEqual(dep.category, 'usdt_deposit');
  assert.strictEqual(dep.amount_usdt, 25.5);
  assert.strictEqual(dep.network, 'TRC20');
  assert.ok(String(dep.tx_hash).startsWith('15e187bd'));
  assert.strictEqual(dep.deposit_address, 'TCustodialDepositAddr1111111111111');
  assert.strictEqual(dep.tron_order_id, 'tron-ord-1');
  assert.ok(dep.derivation_path && dep.derivation_path.includes("m/44"));

  const withdrawals = await listUsdtWithdrawalAdminTransactions({ userId, limit: 50 });
  assert.ok(withdrawals.length >= 1, 'expected at least one USDT withdrawal');
  const wd = withdrawals.find((w) => w.ref_code === 'WD-USDT-1');
  assert.ok(wd, 'WD-USDT-1 missing');
  assert.strictEqual(wd.category, 'usdt_withdrawal');
  assert.strictEqual(wd.amount_usdt, 8);
  assert.strictEqual(wd.net_usdt, 7);
  assert.strictEqual(wd.wallet_address, 'TDestWalletAddr2222222222222222');
  assert.ok(String(wd.tx_hash).startsWith('aa11bb22'));

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Yangon' });
  const depCsv = await buildDailyTransactionsCsv({ date: today, source: 'usdt_deposit', userId });
  assert.ok(depCsv.csv.includes('DEP-USDT-1'));
  assert.ok(depCsv.csv.includes('tx_hash'));
  assert.ok(depCsv.filename.includes('usdt_deposit'));

  const wdCsv = await buildDailyTransactionsCsv({ date: today, source: 'usdt_withdrawal', userId });
  assert.ok(wdCsv.csv.includes('WD-USDT-1'));
  assert.ok(wdCsv.csv.includes('wallet_address'));
  assert.ok(wdCsv.filename.includes('usdt_withdrawal'));

  await closeDb().catch(() => {});
  console.log('test-admin-usdt-tx-tabs: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
