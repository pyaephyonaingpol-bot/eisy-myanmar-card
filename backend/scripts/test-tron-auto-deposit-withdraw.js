#!/usr/bin/env node
/**
 * HD TRC20 auto-deposit credit and instant TRC20 withdrawal.
 * No live Tron node and no private keys — chain reads and sends are stubbed.
 * Run: node backend/scripts/test-tron-auto-deposit-withdraw.js
 */
'use strict';

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

for (const key of Object.keys(process.env)) {
  if (/supabase|turso|pago|telegram|vapid|web_push/i.test(key)) delete process.env[key];
}

const dbFile = path.join(os.tmpdir(), `eisy-tron-auto-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.TRON_HD_SCAN_ON_READ = 'false';
process.env.DEPOSIT_LISTENER_SECRET = 'listener-test-secret';
delete process.env.CRON_SECRET;
delete process.env.TRON_WEBHOOK_SECRET;
delete process.env.DEPOSIT_WEBHOOK_SECRET;

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const DEST = 'TNTU3x2BLuJg3MQCnk6hne43NpgphMK2NJ';

function postJson(port, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function balanceOf(db, userId) {
  const row = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row?.balance_usdt ?? 0);
}

async function main() {
  const { parseTronDepositNotices } = require('../src/services/hdDepositCreditService');
  const direct = parseTronDepositNotices({
    transaction_id: 'tx-tron-grid',
    to: 'TUserHdAddress111111111111111111',
    value: '50000000',
    type: 'Transfer',
    token_info: { symbol: 'USDT', address: USDT_CONTRACT, decimals: 6 },
  });
  assert.strictEqual(direct.length, 1);
  assert.strictEqual(direct[0].txHash, 'tx-tron-grid');
  assert.strictEqual(direct[0].toAddress, 'TUserHdAddress111111111111111111');
  assert.strictEqual(direct[0].amountUsdt, 50);

  const eventNotice = parseTronDepositNotices({
    transactionId: 'tx-event',
    contractAddress: USDT_CONTRACT,
    eventName: 'Transfer',
    topicMap: { to: 'TUserHdAddress111111111111111111', value: '10000000' },
  });
  assert.strictEqual(eventNotice.length, 1);
  assert.strictEqual(eventNotice[0].amountUsdt, 10);

  const ignored = parseTronDepositNotices({
    transaction_id: 'tx-trx',
    to: 'TUserHdAddress111111111111111111',
    value: '100',
    token_info: { symbol: 'TRX', address: 'TNotUsdtContract0000000000000000' },
  });
  assert.strictEqual(ignored.length, 0);

  const plain = parseTronDepositNotices({
    tx_hash: 'tx-plain',
    to_address: 'TPlain',
    amount_usdt: 12.5,
  });
  assert.strictEqual(plain[0].amountUsdt, 12.5);
  assert.strictEqual(plain[0].network, 'TRC20');

  const savedNodeEnv = process.env.NODE_ENV;
  const savedVercel = process.env.VERCEL;
  const savedPaused = process.env.WITHDRAWALS_PAUSED;
  const savedAuto = process.env.AUTO_ONCHAIN_WITHDRAWALS;
  const savedMaster = process.env.MASTER_WALLET_TRANSFERS_PAUSED;
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.WITHDRAWALS_PAUSED;
  delete process.env.AUTO_ONCHAIN_WITHDRAWALS;
  delete process.env.MASTER_WALLET_TRANSFERS_PAUSED;
  delete require.cache[require.resolve('../src/services/securityFlags')];
  const prodFlags = require('../src/services/securityFlags');
  assert.strictEqual(prodFlags.areWithdrawalsPaused(), true, 'production withdrawals stay paused');
  assert.strictEqual(prodFlags.isAutoOnchainWithdrawalEnabled(), false, 'paused production does not broadcast');
  assert.strictEqual(prodFlags.areMasterWalletTransfersPaused(), true);

  process.env.WITHDRAWALS_PAUSED = 'false';
  delete process.env.AUTO_ONCHAIN_WITHDRAWALS;
  delete process.env.MASTER_WALLET_TRANSFERS_PAUSED;
  assert.strictEqual(prodFlags.isAutoOnchainWithdrawalEnabled(), true, 'unpaused TRC20 payouts broadcast');
  assert.strictEqual(prodFlags.areMasterWalletTransfersPaused(), false, 'master pause follows withdrawals');

  process.env.NODE_ENV = savedNodeEnv;
  if (savedVercel == null) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
  if (savedPaused == null) delete process.env.WITHDRAWALS_PAUSED;
  else process.env.WITHDRAWALS_PAUSED = savedPaused;
  if (savedAuto == null) delete process.env.AUTO_ONCHAIN_WITHDRAWALS;
  else process.env.AUTO_ONCHAIN_WITHDRAWALS = savedAuto;
  if (savedMaster == null) delete process.env.MASTER_WALLET_TRANSFERS_PAUSED;
  else process.env.MASTER_WALLET_TRANSFERS_PAUSED = savedMaster;

  const { initDb, closeDb, getDb } = require('../src/db');
  const { UserUsdtWalletAddress } = require('../src/models/UserUsdtWalletAddress');
  const { creditInboundHdDeposits, creditDepositNotice } = require('../src/services/hdDepositCreditService');
  const { runTronOrderPollSafely } = require('../src/services/tronOrderService');
  await initDb();
  const db = getDb();
  const emptyPoll = await runTronOrderPollSafely();
  assert.strictEqual(emptyPoll.skipped, true);
  assert.strictEqual(emptyPoll.reason, 'supabase_disabled');
  assert.ok(emptyPoll.hd_deposits, 'poller must scan HD addresses without Supabase');
  assert.strictEqual(emptyPoll.hd_deposits.addresses, 0);

  const stamp = String(Date.now()).slice(-8);
  const user = await db.run(
    `INSERT INTO users (name, phone, balance_mmk, balance_usdt) VALUES (?, ?, 0, 500)`,
    'HD Credit User',
    `095${stamp}`
  );
  const userId = Number(user.lastID);
  const address = `THdAuto${stamp}11111111111111111`;
  await UserUsdtWalletAddress.create({
    userId,
    network: 'TRC20',
    address,
    addressType: 'custodial',
    derivationIndex: 4,
    derivationPath: "m/44'/195'/0'/0/4",
  });

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/webhook', require('../src/routes/webhook'));
  app.use('/api/cron', require('../src/routes/tronCron'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const cronDenied = await getJson(port, '/api/cron/tron-deposits');
  assert.strictEqual(cronDenied.status, 401);
  assert.strictEqual(cronDenied.json.code, 'CRON_UNAUTHORIZED');

  const ignoredHook = await postJson(port, '/api/webhook/tron', {
    transaction_id: `tx-trx-${stamp}`,
    to: address,
    value: '100',
    token_info: { symbol: 'TRX', address: 'TNotUsdt' },
  });
  assert.strictEqual(ignoredHook.status, 200);
  assert.strictEqual(ignoredHook.json.ignored, true);
  assert.strictEqual(await balanceOf(db, userId), 500);

  const txNew = `tx-hd-new-${stamp}`;
  const txOld = `tx-hd-old-${stamp}`;
  const txDust = `tx-hd-dust-${stamp}`;
  const txOther = `tx-hd-other-${stamp}`;
  const transfers = [
    {
      transaction_id: txOld,
      to: address,
      value: '20000000',
      token_info: { symbol: 'USDT', decimals: 6, address: USDT_CONTRACT },
      type: 'Transfer',
      block_timestamp: Date.now() - (10 * 24 * 60 * 60 * 1000),
    },
    {
      transaction_id: txDust,
      to: address,
      value: '1000000',
      token_info: { symbol: 'USDT', decimals: 6, address: USDT_CONTRACT },
      type: 'Transfer',
      block_timestamp: Date.now(),
    },
    {
      transaction_id: txOther,
      to: 'TSomeoneElse00000000000000000000',
      value: '50000000',
      token_info: { symbol: 'USDT', decimals: 6, address: USDT_CONTRACT },
      type: 'Transfer',
      block_timestamp: Date.now(),
    },
    {
      transaction_id: txNew,
      to: address,
      value: '50000000',
      token_info: { symbol: 'USDT', decimals: 6, address: USDT_CONTRACT },
      type: 'Transfer',
      block_timestamp: Date.now(),
    },
  ];

  const first = await creditInboundHdDeposits({
    userId,
    fetchTransfers: async () => transfers,
  });
  assert.strictEqual(first.credited, 1, 'one confirmed HD deposit is credited');
  assert.ok(first.net_usdt == null || first.matches[0].credited === true);
  const net = Number(first.matches.find((row) => row.tx_hash === txNew).net_usdt);
  assert.ok(net > 0 && net < 50, 'deposit fee is withheld');
  assert.strictEqual(await balanceOf(db, userId), round2(500 + net));

  const replay = await creditInboundHdDeposits({
    userId,
    fetchTransfers: async () => transfers,
  });
  assert.strictEqual(replay.credited, 0, 'the same tx hash is not credited twice');
  assert.ok(replay.already_verified >= 1);
  assert.strictEqual(await balanceOf(db, userId), round2(500 + net));

  const noticeTx = `tx-notice-${stamp}`;
  const noticed = await creditDepositNotice({
    txHash: noticeTx,
    toAddress: address,
    amountUsdt: 20,
    network: 'TRC20',
    depositId: null,
  }, {
    verifyTransfer: async (params) => {
      assert.strictEqual(params.expectedAddress, address);
      assert.strictEqual(params.expectedAmountUsdt, 20);
      assert.strictEqual(params.txHash, noticeTx);
      return { ok: true, status: 'confirmed', amountUsdt: 20 };
    },
  });
  assert.strictEqual(noticed.credited, true);
  const afterNotice = await balanceOf(db, userId);
  assert.strictEqual(afterNotice, round2(500 + net + noticed.net_usdt));
  const noticedAgain = await creditDepositNotice({
    txHash: noticeTx,
    toAddress: address,
    amountUsdt: 20,
    network: 'TRC20',
  }, {
    verifyTransfer: async () => {
      throw new Error('replay must not verify again');
    },
  });
  assert.strictEqual(noticedAgain.alreadyVerified, true);
  assert.strictEqual(await balanceOf(db, userId), afterNotice);

  const masterPath = require.resolve('../src/services/tronMasterWalletService');
  const withdrawalPath = require.resolve('../src/services/withdrawalService');
  const tronMaster = require(masterPath);
  const transferCalls = [];
  tronMaster.transferUsdtTrc20 = async (opts) => {
    transferCalls.push(opts);
    return {
      txId: `txwd${stamp}`.padEnd(64, 'a'),
      fromAddress: 'TMasterTestAddress111111111111111',
      toAddress: opts.toAddress,
      amountUsdt: opts.amountUsdt,
    };
  };
  delete require.cache[withdrawalPath];
  const { createUsdtWithdrawalRequest } = require(withdrawalPath);

  process.env.WITHDRAWALS_PAUSED = 'true';
  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'true';
  process.env.MASTER_WALLET_TRANSFERS_PAUSED = 'true';
  const beforePaused = await balanceOf(db, userId);
  await assert.rejects(
    () => createUsdtWithdrawalRequest(userId, {
      payout_method: 'crypto',
      network: 'TRC20',
      wallet_address: DEST,
      amount_usdt: 20,
    }),
    (err) => err.code === 'WITHDRAWALS_PAUSED'
  );
  assert.strictEqual(transferCalls.length, 0);
  assert.strictEqual(await balanceOf(db, userId), beforePaused);

  process.env.WITHDRAWALS_PAUSED = 'false';
  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'true';
  process.env.MASTER_WALLET_TRANSFERS_PAUSED = 'false';
  await assert.rejects(
    () => createUsdtWithdrawalRequest(userId, {
      payout_method: 'crypto',
      network: 'TRC20',
      wallet_address: DEST,
      amount_usdt: 100000,
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE'
  );
  assert.strictEqual(transferCalls.length, 0);
  assert.strictEqual(await balanceOf(db, userId), beforePaused);

  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'false';
  const queued = await createUsdtWithdrawalRequest(userId, {
    payout_method: 'crypto',
    network: 'TRC20',
    wallet_address: DEST,
    amount_usdt: 20,
  });
  assert.strictEqual(queued.withdrawal.status, 'pending');
  assert.strictEqual(queued.payout, null);
  assert.strictEqual(transferCalls.length, 0);
  const afterQueue = await balanceOf(db, userId);
  assert.strictEqual(afterQueue, round2(beforePaused - 20));

  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'true';
  process.env.MASTER_WALLET_TRANSFERS_PAUSED = 'false';
  const sent = await createUsdtWithdrawalRequest(userId, {
    payout_method: 'crypto',
    network: 'TRC20',
    wallet_address: DEST,
    amount_usdt: 50,
  });
  assert.strictEqual(sent.withdrawal.status, 'completed');
  assert.strictEqual(sent.payout.status, 'completed');
  assert.ok(sent.payout.tx_hash);
  assert.strictEqual(transferCalls.length, 1);
  assert.strictEqual(transferCalls[0].toAddress, DEST);
  assert.strictEqual(Number(transferCalls[0].amountUsdt), Number(sent.breakdown.net_usdt));
  assert.ok(Number(sent.breakdown.net_usdt) > 0);
  assert.ok(Number(sent.breakdown.net_usdt) < 50);
  assert.strictEqual(await balanceOf(db, userId), round2(afterQueue - 50));

  await new Promise((resolve) => server.close(resolve));
  await closeDb().catch(() => {});
  console.log('test-tron-auto-deposit-withdraw: OK');
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
