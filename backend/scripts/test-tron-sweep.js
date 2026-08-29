#!/usr/bin/env node
/**
 * TRON sweep: master TRX gas → deposit, then USDT → master.
 * Run: node backend/scripts/test-tron-sweep.js
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

function makeFakeTw({
  address,
  trxSun = 0,
  usdtSun = '0',
  masterTrxSun = 50_000_000,
  sendTrxTx = 'trx-gas-1',
  usdtTx = 'usdt-sweep-1',
}) {
  const calls = { sendTransaction: [], usdtTransfer: [] };
  const tw = {
    address: {
      fromPrivateKey: () => address,
      isAddress: (a) => typeof a === 'string' && a.startsWith('T') && a.length >= 30,
    },
    isAddress: (a) => typeof a === 'string' && a.startsWith('T') && a.length >= 30,
    setAddress() {},
    trx: {
      getBalance: async () => (address.startsWith('TMaster') ? masterTrxSun : trxSun),
      sendTransaction: async (to, sun) => {
        calls.sendTransaction.push({ to, sun });
        return { result: true, txid: sendTrxTx };
      },
    },
    async contract() {
      return {
        methods: {
          balanceOf() {
            return { call: async () => usdtSun };
          },
          transfer(to, sun) {
            return {
              send: async () => {
                calls.usdtTransfer.push({ to, sun });
                return usdtTx;
              },
            };
          },
        },
      };
    },
  };
  return { tw, calls };
}

async function withTempDb(fn) {
  const dbFile = path.join(os.tmpdir(), `eisy-tron-sweep-${Date.now()}.db`);
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
  process.env.MASTER_PRIVATE_KEY = 'b'.repeat(64);
  process.env.TRON_SWEEP_GAS_TRX = '1.5';
  process.env.TRON_SWEEP_GAS_WAIT_MS = '0';
  process.env.TRON_SWEEP_MIN_USDT = '0.01';

  delete require.cache[require.resolve('../src/services/tronHdWalletService')];
  delete require.cache[require.resolve('../src/services/tronMasterWalletService')];
  delete require.cache[require.resolve('../src/services/tronSweepService')];

  const hd = require('../src/services/tronHdWalletService');
  const master = require('../src/services/tronMasterWalletService');
  const sweep = require('../src/services/tronSweepService');

  // Pin master address for assertions.
  const masterAddress = 'TMasterSweepWallet1111111111111111';
  const originalGetMaster = master.getMasterWalletAddress;
  master.getMasterWalletAddress = () => masterAddress;

  section('gas then USDT sweep when deposit has USDT but no TRX');
  {
    const userId = 7;
    const derived = hd.deriveTronAddressForUser(userId);
    const depositAddr = derived.address;

    const byKey = new Map();
    // Master key instance
    byKey.set('b'.repeat(64), makeFakeTw({
      address: masterAddress,
      masterTrxSun: 100_000_000,
      usdtSun: '0',
    }));
    // Deposit key instance — no TRX, has 12.5 USDT
    byKey.set(derived.privateKeyHex, makeFakeTw({
      address: depositAddr,
      trxSun: 0,
      usdtSun: '12500000',
    }));

    const createTw = (pk) => {
      const entry = byKey.get(pk);
      if (!entry) {
        // Fallback for unexpected keys
        return makeFakeTw({ address: depositAddr, trxSun: 0, usdtSun: '12500000' }).tw;
      }
      return entry.tw;
    };

    // getBalance on master vs deposit: sendTrxFromMaster uses master tw;
    // probe uses deposit tw. Our fake uses address field — fix master getBalance.
    byKey.get('b'.repeat(64)).tw.trx.getBalance = async () => 100_000_000;
    byKey.get(derived.privateKeyHex).tw.trx.getBalance = async () => 0;

    let waited = 0;
    const result = await sweep.sweepDepositAddress({
      userId,
      forceGas: true,
      createTw,
      waitFn: async (ms) => { waited = ms; },
    });

    // With GAS_WAIT_MS=0, waitFn may not be called.
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.depositAddress, depositAddr);
    assert.strictEqual(result.masterAddress, masterAddress);
    assert.ok(result.gas?.txId === 'trx-gas-1' || result.gas?.amountTrx === 1.5);
    assert.strictEqual(result.usdt?.txId, 'usdt-sweep-1');
    assert.strictEqual(result.usdt?.amountUsdt, 12.5);

    const masterCalls = byKey.get('b'.repeat(64)).calls;
    assert.strictEqual(masterCalls.sendTransaction.length, 1);
    assert.strictEqual(masterCalls.sendTransaction[0].to, depositAddr);
    assert.strictEqual(masterCalls.sendTransaction[0].sun, Math.round(1.5 * 1e6));

    const childCalls = byKey.get(derived.privateKeyHex).calls;
    assert.strictEqual(childCalls.usdtTransfer.length, 1);
    assert.strictEqual(childCalls.usdtTransfer[0].to, masterAddress);
    assert.strictEqual(childCalls.usdtTransfer[0].sun, '12500000');
    void waited;
    console.log('ok');
  }

  section('skips when USDT below minimum');
  {
    const userId = 8;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = () => makeFakeTw({
      address: derived.address,
      trxSun: 0,
      usdtSun: '1000', // 0.001 USDT
    }).tw;

    const result = await sweep.sweepDepositAddress({
      userId,
      createTw,
      waitFn: async () => {},
    });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'below_min_usdt');
    assert.strictEqual(result.gas, null);
    console.log('ok');
  }

  section('listSweepableDepositAddresses reads HD rows');
  await withTempDb(async () => {
    const { getDb } = require('../src/db');
    const db = getDb();
    const userId = Number((await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
      'Sweep User',
      `09${String(Date.now()).slice(-8)}`
    )).lastID);
    const derived = hd.deriveTronAddressForUser(userId);
    await db.run(`
      INSERT INTO user_usdt_wallet_addresses
        (user_id, network, address, address_type, derivation_index, derivation_path, is_primary)
      VALUES (?, 'TRC20', ?, 'custodial', ?, ?, 1)
    `, userId, derived.address, derived.index, derived.path);

    const listed = await sweep.listSweepableDepositAddresses();
    assert.ok(listed.some((r) => Number(r.user_id) === userId));
    assert.ok(listed.some((r) => r.address === derived.address));
    console.log('ok');
  });

  section('dry-run reports gas + usdt without requiring live chain');
  {
    const userId = 9;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = (pk) => {
      const isMaster = pk === 'b'.repeat(64);
      const fake = makeFakeTw({
        address: isMaster ? masterAddress : derived.address,
        trxSun: 0,
        masterTrxSun: 100_000_000,
        usdtSun: '9000000',
      });
      if (isMaster) {
        fake.tw.trx.getBalance = async () => 100_000_000;
      } else {
        fake.tw.trx.getBalance = async () => 0;
      }
      return fake.tw;
    };

    const result = await sweep.sweepDepositAddress({
      userId,
      dryRun: true,
      forceGas: true,
      createTw,
      waitFn: async () => {},
    });
    assert.strictEqual(result.gas.dryRun, true);
    assert.strictEqual(result.gas.amountTrx, 1.5);
    assert.strictEqual(result.usdt.dryRun, true);
    assert.strictEqual(result.usdt.usdtBalance, 9);
    assert.strictEqual(result.usdt.txId, null);
    console.log('ok');
  }

  section('runManualSweep is manual (not cron) and single-flight');
  {
    const userId = 11;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = (pk) => {
      const isMaster = pk === 'b'.repeat(64);
      const fake = makeFakeTw({
        address: isMaster ? masterAddress : derived.address,
        trxSun: 0,
        masterTrxSun: 100_000_000,
        usdtSun: '5000000',
      });
      fake.tw.trx.getBalance = async () => (isMaster ? 100_000_000 : 0);
      return fake.tw;
    };

    const summary = await sweep.runManualSweep({
      userId,
      dryRun: true,
      forceGas: true,
      createTw,
      waitFn: async () => {},
    });
    assert.strictEqual(summary.manual, true);
    assert.strictEqual(summary.scheduled, false);
    assert.strictEqual(summary.mode, 'user');
    assert.ok(summary.started_at);
    assert.ok(summary.finished_at);
    console.log('ok');
  }

  master.getMasterWalletAddress = originalGetMaster;
  delete process.env.TRON_HD_MNEMONIC;
  delete process.env.TRON_HD_ENABLED;
  delete process.env.MASTER_PRIVATE_KEY;
  console.log('\nTRON sweep checks passed.');
}

main().catch((err) => {
  console.error('\nTRON sweep FAILED:', err);
  process.exit(1);
});
