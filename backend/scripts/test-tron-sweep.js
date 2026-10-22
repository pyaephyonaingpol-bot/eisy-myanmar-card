#!/usr/bin/env node
/**
 * TRON sweep: Netts energy → USDT → master (HD deposit addresses).
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
}) {
  const tw = {
    address: {
      fromPrivateKey: () => address,
    },
    isAddress: (a) => typeof a === 'string' && a.startsWith('T') && a.length >= 30,
    setAddress() {},
    trx: {
      getBalance: async () => trxSun,
    },
    async contract() {
      return {
        methods: {
          balanceOf() {
            return { call: async () => usdtSun };
          },
        },
      };
    },
  };
  return tw;
}

function makeNettsSweepMock({ masterAddress, usdtSun, txId = 'usdt-sweep-1' }) {
  return async ({
    childAddress,
    childPrivateKey,
    amountToSweep,
    destinationAddress,
    idempotencyNonce,
  }) => {
    assert.ok(childAddress);
    assert.ok(childPrivateKey);
    assert.ok(amountToSweep > 0);
    assert.strictEqual(destinationAddress, masterAddress);
    assert.ok(idempotencyNonce);
    return {
      ok: true,
      txid: txId,
      from: childAddress,
      to: masterAddress,
      amountToSweep,
      amountInSun: usdtSun,
      amountCapped: false,
      energy: 65_000,
      idempotencyNonce,
      nettsOrderId: '1H-test',
      nettsDelegationHash: 'hash-test',
      nettsPaidTrx: 1.2,
      nettsCached: false,
    };
  };
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
  process.env.TRON_SWEEP_MIN_USDT = '0.01';

  delete require.cache[require.resolve('../src/services/tronHdWalletService')];
  delete require.cache[require.resolve('../src/services/tronMasterWalletService')];
  delete require.cache[require.resolve('../src/services/tronSweepService')];

  const hd = require('../src/services/tronHdWalletService');
  const master = require('../src/services/tronMasterWalletService');
  const sweep = require('../src/services/tronSweepService');

  const masterAddress = 'TMasterSweepWallet1111111111111111';
  const originalGetMaster = master.getMasterWalletAddress;
  master.getMasterWalletAddress = () => masterAddress;

  section('Netts energy then USDT sweep when deposit has USDT');
  {
    const userId = 7;
    const derived = hd.deriveTronAddressForUser(userId);
    const depositAddr = derived.address;
    const usdtSun = '12500000';

    const createTw = (pk) => makeFakeTw({
      address: pk === derived.privateKeyHex ? depositAddr : masterAddress,
      trxSun: 0,
      usdtSun: pk === derived.privateKeyHex ? usdtSun : '0',
    });

    const nettsCalls = [];
    const nettsFn = makeNettsSweepMock({ masterAddress, usdtSun });
    const wrappedNetts = async (params) => {
      nettsCalls.push(params);
      return nettsFn(params);
    };

    const result = await sweep.sweepDepositAddress({
      userId,
      forceGas: true,
      createTw,
      sweepUsdtWithNettsEnergyFn: wrappedNetts,
      waitFn: async () => {},
    });

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.depositAddress, depositAddr);
    assert.strictEqual(result.masterAddress, masterAddress);
    assert.strictEqual(result.gas, null);
    assert.strictEqual(result.energy?.netts, true);
    assert.strictEqual(result.energy?.orderId, '1H-test');
    assert.strictEqual(result.usdt?.txId, 'usdt-sweep-1');
    assert.strictEqual(result.usdt?.amountUsdt, 12.5);
    assert.strictEqual(nettsCalls.length, 1);
    assert.strictEqual(nettsCalls[0].childAddress, depositAddr);
    console.log('ok');
  }

  section('skips when USDT below minimum');
  {
    const userId = 8;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = () => makeFakeTw({
      address: derived.address,
      trxSun: 0,
      usdtSun: '1000',
    });

    let nettsCalled = false;
    const result = await sweep.sweepDepositAddress({
      userId,
      createTw,
      sweepUsdtWithNettsEnergyFn: async () => {
        nettsCalled = true;
        throw new Error('should not call Netts');
      },
    });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, 'below_min_usdt');
    assert.strictEqual(result.gas, null);
    assert.strictEqual(nettsCalled, false);
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

  section('dry-run reports Netts energy + usdt without live chain');
  {
    const userId = 9;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = () => makeFakeTw({
      address: derived.address,
      trxSun: 0,
      usdtSun: '9000000',
    });

    let nettsCalled = false;
    const result = await sweep.sweepDepositAddress({
      userId,
      dryRun: true,
      forceGas: true,
      createTw,
      sweepUsdtWithNettsEnergyFn: async () => {
        nettsCalled = true;
        throw new Error('dry-run must not call Netts');
      },
    });
    assert.strictEqual(result.energy.dryRun, true);
    assert.strictEqual(result.energy.energy, sweep.getNettsEnergyPerSweep());
    assert.strictEqual(result.usdt.dryRun, true);
    assert.strictEqual(result.usdt.usdtBalance, 9);
    assert.strictEqual(result.usdt.txId, null);
    assert.strictEqual(nettsCalled, false);
    console.log('ok');
  }

  section('runManualSweep is manual (not cron) and single-flight');
  {
    const userId = 11;
    const derived = hd.deriveTronAddressForUser(userId);
    const createTw = (pk) => makeFakeTw({
      address: pk === derived.privateKeyHex ? derived.address : masterAddress,
      usdtSun: '5000000',
    });

    const summary = await sweep.runManualSweep({
      userId,
      dryRun: true,
      createTw,
      sweepUsdtWithNettsEnergyFn: async () => {
        throw new Error('dry-run');
      },
    });
    assert.strictEqual(summary.manual, true);
    assert.strictEqual(summary.scheduled, false);
    assert.strictEqual(summary.mode, 'user');
    assert.strictEqual(summary.nettsEnergy, 65_000);
    assert.ok(summary.started_at);
    assert.ok(summary.finished_at);
    console.log('ok');
  }

  section('withTronRateLimitRetry retries HTTP 429');
  {
    let attempts = 0;
    const waits = [];
    const result = await sweep.withTronRateLimitRetry('test', async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('Too Many Requests');
        err.status = 429;
        throw err;
      }
      return 'ok';
    }, {
      waitFn: async (ms) => { waits.push(ms); },
    });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(waits, [2000, 4000]);
    console.log('ok');
  }

  section('sweepAllCustodialDeposits waits between accounts');
  {
    const prevDelay = process.env.TRON_SWEEP_ACCOUNT_DELAY_MS;
    process.env.TRON_SWEEP_ACCOUNT_DELAY_MS = '1000';
    const waits = [];
    const waitFn = async (ms) => { waits.push(ms); };

    await withTempDb(async () => {
      const { getDb } = require('../src/db');
      const db = getDb();
      for (let i = 0; i < 2; i += 1) {
        const userId = Number((await db.run(
          `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
          `Sweep Batch ${i}`,
          `08${String(Date.now() + i).slice(-8)}`
        )).lastID);
        const derived = hd.deriveTronAddressForUser(userId);
        await db.run(`
          INSERT INTO user_usdt_wallet_addresses
            (user_id, network, address, address_type, derivation_index, derivation_path, is_primary)
          VALUES (?, 'TRC20', ?, 'custodial', ?, ?, 1)
        `, userId, derived.address, derived.index, derived.path);
      }

      const summary = await sweep.sweepAllCustodialDeposits({
        dryRun: true,
        limit: 10,
        waitFn,
        createTw: (pk) => {
          const derived = hd.deriveTronAddressForUser(1);
          return makeFakeTw({
            address: derived.address,
            usdtSun: '1000000',
          });
        },
        sweepUsdtWithNettsEnergyFn: async () => {
          throw new Error('dry-run must not call Netts');
        },
      });
      assert.strictEqual(summary.checked, 2);
      assert.ok(waits.includes(1000), '1s throttle between accounts');
    });

    if (prevDelay == null) delete process.env.TRON_SWEEP_ACCOUNT_DELAY_MS;
    else process.env.TRON_SWEEP_ACCOUNT_DELAY_MS = prevDelay;
    console.log('ok');
  }

  section('summarizeSweepTransferTotals aggregates USDT');
  {
    const totals = sweep.summarizeSweepTransferTotals({
      dryRun: false,
      results: [
        {
          ok: true,
          userId: 1,
          depositAddress: 'TDep1',
          usdt: { amountUsdt: 30, txId: 'abc123' },
        },
        { ok: true, skipped: true, userId: 2 },
        { ok: false, userId: 3, error: 'fail' },
      ],
    });
    assert.strictEqual(totals.total_usdt, 30);
    assert.strictEqual(totals.transfer_count, 1);
    assert.strictEqual(totals.transfers.length, 1);
    console.log('ok');
  }

  section('stored derivation_index used when offset drifted');
  {
    process.env.TRON_HD_INDEX_OFFSET = '100';
    delete require.cache[require.resolve('../src/services/tronHdWalletService')];
    delete require.cache[require.resolve('../src/services/tronSweepService')];
    const hdOffset = require('../src/services/tronHdWalletService');
    const sweepOffset = require('../src/services/tronSweepService');
    const userId = 12;
    const legacyIndex = userId;
    const legacyDerived = hdOffset.deriveTronAccountAtIndex(legacyIndex);
    const result = await sweepOffset.sweepDepositAddress({
      userId,
      address: legacyDerived.address,
      derivationIndex: legacyIndex,
      createTw: (pk) => makeFakeTw({ address: legacyDerived.address, usdtSun: '5000000' }),
      sweepUsdtWithNettsEnergyFn: makeNettsSweepMock({
        masterAddress,
        usdtSun: '5000000',
      }),
      waitFn: async () => {},
    });
    assert.strictEqual(result.depositAddress, legacyDerived.address);
    delete process.env.TRON_HD_INDEX_OFFSET;
    delete require.cache[require.resolve('../src/services/tronHdWalletService')];
    delete require.cache[require.resolve('../src/services/tronSweepService')];
    console.log('ok');
  }

  section('address mismatch aborts before Netts');
  {
    const sweepFresh = require('../src/services/tronSweepService');
    await assert.rejects(
      () => sweepFresh.sweepDepositAddress({
        userId: 13,
        address: 'TWrongDepositAddress111111111111111',
        derivationIndex: 13,
        createTw: () => makeFakeTw({ address: 'TWrongDepositAddress111111111111111', usdtSun: '9000000' }),
        sweepUsdtWithNettsEnergyFn: async () => {
          throw new Error('Netts must not run');
        },
      }),
      (err) => err.code === 'SWEEP_ADDRESS_MISMATCH',
    );
    console.log('ok');
  }

  section('buildNettsIdempotencyNonce stable vs forceGas');
  {
    const stable = sweep.buildNettsIdempotencyNonce({
      forceGas: false,
      userId: 3,
      derivationIndex: 4,
      depositAddress: 'TDep',
    });
    assert.strictEqual(stable, 'sweep:3:4:TDep');
    const forced = sweep.buildNettsIdempotencyNonce({
      forceGas: true,
      userId: 3,
      derivationIndex: 4,
      depositAddress: 'TDep',
    });
    assert.notStrictEqual(forced, stable);
    assert.strictEqual(forced.length, 32);
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
