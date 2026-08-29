#!/usr/bin/env node
/**
 * Per-user TRON wallet management façade tests.
 * Run: node backend/scripts/test-tron-wallet-service.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function withTempDb(fn) {
  const dbFile = path.join(os.tmpdir(), `eisy-tron-wallet-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  try {
    await fn();
  } finally {
    await closeDb?.();
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

async function main() {
  const mnemonic = generateMnemonic(wordlist, 128);
  process.env.TRON_HD_ENABLED = 'true';
  process.env.TRON_HD_MNEMONIC = mnemonic;
  process.env.MASTER_PRIVATE_KEY = 'a'.repeat(64);

  delete require.cache[require.resolve('../src/services/tronHdWalletService')];
  delete require.cache[require.resolve('../src/services/tronDepositAddressService')];
  delete require.cache[require.resolve('../src/services/tronWalletService')];

  section('generateUserDepositAddress is unique + deterministic');
  await withTempDb(async () => {
    const wallet = require('../src/services/tronWalletService');
    const { getDb } = require('../src/db');
    const db = getDb();

    const u1 = Number((await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 50)`,
      'W1',
      `09${String(Date.now()).slice(-8)}`
    )).lastID);
    const u2 = Number((await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 50)`,
      'W2',
      `09${String(Date.now() + 1).slice(-8)}`
    )).lastID);

    const a1 = await wallet.generateUserDepositAddress(u1);
    const a1b = await wallet.generateUserDepositAddress(u1);
    const a2 = await wallet.generateUserDepositAddress(u2);

    assert.strictEqual(a1.source, 'hd');
    assert.strictEqual(a1.address, a1b.address);
    assert.notStrictEqual(a1.address, a2.address);
    assert.strictEqual(a1b.created, false);

    const summary = await wallet.getTronWalletSummary(u1);
    assert.strictEqual(summary.deposit_address, a1.address);
    assert.strictEqual(summary.balance.available_usdt, 50);
    console.log('ok');
  });

  section('withdrawFromMasterWallet debits ledger and calls transfer');
  await withTempDb(async () => {
    const wallet = require('../src/services/tronWalletService');
    const tron = require('../src/services/tronMasterWalletService');
    const { getDb } = require('../src/db');
    const db = getDb();

    const userId = Number((await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 100)`,
      'Withdraw User',
      `09${String(Date.now()).slice(-8)}`
    )).lastID);

    const dest = wallet.getPublicDepositAddressForUser(userId).address;
    const original = tron.transferUsdtTrc20;
    let transferArgs;
    tron.transferUsdtTrc20 = async (args) => {
      transferArgs = args;
      return {
        txId: 'tx-wallet-wd-1',
        fromAddress: 'TMasterTestAddress1111111111111111',
        toAddress: args.toAddress,
        amountUsdt: Number(args.amountUsdt),
      };
    };

    const result = await wallet.withdrawFromMasterWallet(userId, {
      toAddress: dest,
      amountUsdt: 25,
    });

    assert.strictEqual(result.txId, 'tx-wallet-wd-1');
    assert.strictEqual(result.netPayout, 23);
    assert.strictEqual(transferArgs.amountUsdt, 23);
    assert.strictEqual(transferArgs.toAddress, dest);

    const user = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
    assert.strictEqual(Number(user.balance_usdt), 75);
    tron.transferUsdtTrc20 = original;
    console.log('ok');
  });

  section('createDepositIntent attaches HD address');
  await withTempDb(async () => {
    const wallet = require('../src/services/tronWalletService');
    const crypto = require('crypto');
    const { getDb } = require('../src/db');
    const db = getDb();
    const userId = Number((await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
      'Deposit User',
      `09${String(Date.now()).slice(-8)}`
    )).lastID);

    const expected = wallet.getPublicDepositAddressForUser(userId).address;
    const supabase = require('../src/lib/supabase');
    supabase.isSupabaseEnabled = () => true;
    supabase.getSupabase = () => ({
      from(table) {
        if (table !== 'orders') {
          return { upsert: async () => ({ error: null }) };
        }
        return {
          insert(payload) {
            const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload };
            return { select() { return { single: async () => ({ data: row, error: null }) }; } };
          },
        };
      },
    });

    const created = await wallet.createDepositIntent(userId, { amount_usdt: 15 });
    assert.strictEqual(created.payment.deposit_address, expected);
    assert.strictEqual(created.payment.deposit_address_source, 'hd');
    console.log('ok');
  });

  delete process.env.TRON_HD_MNEMONIC;
  delete process.env.TRON_HD_ENABLED;
  delete process.env.MASTER_PRIVATE_KEY;
  console.log('\nTRON wallet management checks passed.');
}

main().catch((err) => {
  console.error('\nTRON wallet management FAILED:', err);
  process.exit(1);
});
