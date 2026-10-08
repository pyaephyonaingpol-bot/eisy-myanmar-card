#!/usr/bin/env node
/**
 * USDT wallet credit: atomic balance update, ledger row, and idempotent replay
 * for user/admin creditDepositAndVerify and the blockchain deposit webhook.
 * Run: node backend/scripts/test-deposit-wallet-credit.js
 */
'use strict';

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

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

async function balanceOf(db, userId) {
  const row = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row?.balance_usdt ?? 0);
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-deposit-credit-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.DEPOSIT_WEBHOOK_SECRET = 'deposit-test-secret';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const DepositRequest = require('../src/models/DepositRequest');
  const { UserUsdtWalletAddress } = require('../src/models/UserUsdtWalletAddress');
  const { creditDepositAndVerify } = require('../src/services/depositService');
  const { applyIncomingDepositCredit } = require('../src/services/depositCreditService');

  await initDb();
  const db = getDb();
  const stamp = String(Date.now()).slice(-8);

  const userA = await db.run(
    `INSERT INTO users (name, phone, balance_mmk, balance_usdt) VALUES (?, ?, 0, 10)`,
    'Credit User A',
    `091${stamp}`
  );
  const userB = await db.run(
    `INSERT INTO users (name, phone, balance_mmk, balance_usdt) VALUES (?, ?, 0, 3)`,
    'Credit User B',
    `092${stamp}`
  );
  const userAId = Number(userA.lastID);
  const userBId = Number(userB.lastID);

  const deposit = await DepositRequest.create({
    userId: userAId,
    amountMmk: 0,
    amountUsd: 100,
    refCode: `REF-CREDIT-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    platformProfitUsd: 2,
    metadata: {
      deposit_address: 'TUserADepositAddress111111111111111',
      payment_fee: { fee_usdt: 2, net_usdt: 98, platform_profit_usd: 2 },
      pricing: { fee_usdt: 2, net_usdt: 98, platform_profit_usd: 2 },
    },
  });

  assert.strictEqual(await balanceOf(db, userAId), 10, 'pending deposit must not credit the wallet');
  assert.strictEqual(await balanceOf(db, userBId), 3);

  let verifyCalls = 0;
  const txHash = `tx-credit-${stamp}`;
  const first = await applyIncomingDepositCredit({
    source: 'user_submit',
    depositId: deposit.id,
    userId: userAId,
    txHash,
    toAddress: 'TUserADepositAddress111111111111111',
    amountUsdt: 100,
    network: 'TRC20',
    createdBy: 'user',
    verifyTransfer: async () => {
      verifyCalls += 1;
      return { ok: true, status: 'confirmed', amountUsdt: 100 };
    },
  });

  assert.strictEqual(first.credited, true);
  assert.strictEqual(first.alreadyVerified, false);
  assert.strictEqual(first.net_usdt, 98);
  assert.strictEqual(first.balance_usdt, 108);
  assert.strictEqual(await balanceOf(db, userAId), 108);
  assert.strictEqual(await balanceOf(db, userBId), 3, 'another user balance stays unchanged');
  assert.strictEqual(verifyCalls, 1);

  const verifiedRow = await db.get(
    'SELECT status, tx_hash FROM deposit_requests_v2 WHERE id = ?',
    deposit.id
  );
  assert.strictEqual(verifiedRow.status, 'VERIFIED');
  assert.strictEqual(verifiedRow.tx_hash, txHash);

  const ledger = await db.get(
    `SELECT tx_type, direction, amount_usdt, balance_before, balance_after, reference_id
     FROM usdt_wallet_transactions
     WHERE user_id = ? AND reference_type = 'deposit_requests_v2' AND reference_id = ?`,
    userAId,
    deposit.id
  );
  assert.ok(ledger, 'ledger row is written with the balance update');
  assert.strictEqual(ledger.tx_type, 'deposit_verified');
  assert.strictEqual(ledger.direction, 'credit');
  assert.strictEqual(Number(ledger.amount_usdt), 98);
  assert.strictEqual(Number(ledger.balance_before), 10);
  assert.strictEqual(Number(ledger.balance_after), 108);

  const replay = await applyIncomingDepositCredit({
    source: 'blockchain_webhook',
    txHash,
    toAddress: 'TUserADepositAddress111111111111111',
    amountUsdt: 100,
    network: 'TRC20',
    verifyTransfer: async () => {
      verifyCalls += 1;
      throw new Error('replay must not verify or credit again');
    },
  });
  assert.strictEqual(replay.credited, false);
  assert.strictEqual(replay.alreadyVerified, true);
  assert.strictEqual(replay.balance_usdt, 108);
  assert.strictEqual(await balanceOf(db, userAId), 108);
  assert.strictEqual(verifyCalls, 1, 'verified tx hash returns before a second chain check');

  const adminDeposit = await DepositRequest.create({
    userId: userAId,
    amountMmk: 0,
    amountUsd: 20,
    refCode: `REF-ADMIN-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    platformProfitUsd: 1,
    metadata: {
      deposit_address: 'TUserADepositAddress111111111111111',
      payment_fee: { fee_usdt: 1, net_usdt: 19 },
      pricing: { fee_usdt: 1, net_usdt: 19 },
    },
  });
  const adminHash = `tx-admin-${stamp}`;
  const approved = await creditDepositAndVerify(adminDeposit, {
    txnId: adminHash,
    createdBy: 'admin',
    adminNote: 'manual approval test',
    reviewedByAdminId: 1,
  });
  assert.strictEqual(approved.alreadyVerified, false);
  assert.strictEqual(approved.net_usdt, 19);
  assert.strictEqual(Number(approved.user.balance_usdt), 127);
  const approvedAgain = await creditDepositAndVerify(
    await DepositRequest.findById(adminDeposit.id),
    { txnId: adminHash, createdBy: 'admin' }
  );
  assert.strictEqual(approvedAgain.alreadyVerified, true);
  assert.strictEqual(await balanceOf(db, userAId), 127);
  assert.strictEqual(await balanceOf(db, userBId), 3);

  const rejected = await DepositRequest.create({
    userId: userAId,
    amountMmk: 0,
    amountUsd: 40,
    refCode: `REF-FAIL-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata: {
      deposit_address: 'TUserADepositAddress111111111111111',
      payment_fee: { fee_usdt: 1, net_usdt: 39 },
    },
  });
  await assert.rejects(
    () => applyIncomingDepositCredit({
      source: 'blockchain_webhook',
      depositId: rejected.id,
      txHash: `tx-fail-${stamp}`,
      toAddress: 'TUserADepositAddress111111111111111',
      amountUsdt: 40,
      verifyTransfer: async () => ({ ok: false, status: 'invalid', message: 'not on chain' }),
    }),
    (err) => err.code === 'ON_CHAIN_VERIFY_FAILED'
  );
  const stillPending = await DepositRequest.findById(rejected.id);
  assert.strictEqual(stillPending.status, 'PENDING');
  assert.strictEqual(await balanceOf(db, userAId), 127);

  const userBDeposit = await DepositRequest.create({
    userId: userBId,
    amountMmk: 0,
    amountUsd: 100,
    refCode: `REF-B-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata: {
      deposit_address: 'TUserBDepositAddress222222222222222',
      payment_fee: { fee_usdt: 2, net_usdt: 98 },
    },
  });
  await assert.rejects(
    () => applyIncomingDepositCredit({
      source: 'blockchain_webhook',
      depositId: userBDeposit.id,
      txHash: `tx-mismatch-${stamp}`,
      toAddress: 'TUserADepositAddress111111111111111',
      amountUsdt: 100,
      verifyTransfer: async () => {
        throw new Error('mismatched address must not be verified');
      },
    }),
    (err) => err.code === 'DEPOSIT_ADDRESS_MISMATCH'
  );
  assert.strictEqual((await DepositRequest.findById(userBDeposit.id)).status, 'PENDING');
  assert.strictEqual(await balanceOf(db, userBId), 3);
  assert.strictEqual(await balanceOf(db, userAId), 127);

  const custodialAddress = `TCustodial${stamp}11111111111111111`;
  await UserUsdtWalletAddress.create({
    userId: userAId,
    network: 'TRC20',
    address: custodialAddress,
    addressType: 'custodial',
    derivationIndex: 7,
    derivationPath: "m/44'/195'/0'/0/7",
  });
  const chainHash = `tx-chain-${stamp}`;
  const discovered = await applyIncomingDepositCredit({
    source: 'blockchain_webhook',
    txHash: chainHash,
    toAddress: custodialAddress,
    amountUsdt: 50,
    network: 'TRC20',
    verifyTransfer: async (params) => {
      assert.strictEqual(params.expectedAddress, custodialAddress);
      assert.strictEqual(params.expectedAmountUsdt, 50);
      return { ok: true, status: 'confirmed', amountUsdt: 50 };
    },
  });
  assert.strictEqual(discovered.credited, true);
  assert.strictEqual(Number(discovered.deposit.user_id), userAId);
  assert.ok(discovered.net_usdt > 0);
  assert.strictEqual(
    await balanceOf(db, userAId),
    round2(127 + discovered.net_usdt)
  );
  const afterDiscover = await balanceOf(db, userAId);
  const discoveredAgain = await applyIncomingDepositCredit({
    source: 'blockchain_webhook',
    txHash: chainHash,
    toAddress: custodialAddress,
    amountUsdt: 50,
    verifyTransfer: async () => {
      throw new Error('second chain event must not credit');
    },
  });
  assert.strictEqual(discoveredAgain.alreadyVerified, true);
  assert.strictEqual(await balanceOf(db, userAId), afterDiscover);
  assert.strictEqual(await balanceOf(db, userBId), 3);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/webhook', require('../src/routes/webhook'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const beforeHttp = await balanceOf(db, userAId);

  const denied = await postJson(port, '/api/webhook/deposit', {
    tx_hash: `tx-http-denied-${stamp}`,
    to_address: custodialAddress,
    amount_usdt: 50,
    skip_chain_verify: true,
  }, { 'x-deposit-webhook-secret': 'wrong' });
  assert.strictEqual(denied.status, 401);
  assert.strictEqual(denied.json.credited, false);

  const missing = await postJson(port, '/api/webhook/deposit', {
    to_address: custodialAddress,
    amount_usdt: 50,
    skip_chain_verify: true,
  }, { 'x-deposit-webhook-secret': 'deposit-test-secret' });
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.json.code, 'MISSING_TX_HASH');

  const unknown = await postJson(port, '/api/webhook/deposit', {
    tx_hash: `tx-http-unknown-${stamp}`,
    to_address: 'TUnknownAddress000000000000000000',
    amount_usdt: 25,
    skip_chain_verify: true,
  }, { 'x-deposit-webhook-secret': 'deposit-test-secret' });
  assert.strictEqual(unknown.status, 404);
  assert.strictEqual(unknown.json.credited, false);

  const noAddress = await DepositRequest.create({
    userId: userAId,
    amountMmk: 0,
    amountUsd: 15,
    refCode: `REF-NOADDR-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata: { payment_fee: { fee_usdt: 1, net_usdt: 14 } },
  });
  const unverified = await postJson(port, '/api/webhook/deposit', {
    tx_hash: `tx-http-noaddr-${stamp}`,
    deposit_id: noAddress.id,
    to_address: 'TNotThisUsersAddress00000000000000',
    amount_usdt: 15,
    skip_chain_verify: true,
  }, { 'x-deposit-webhook-secret': 'deposit-test-secret' });
  assert.strictEqual(unverified.status, 400);
  assert.strictEqual(unverified.json.code, 'DEPOSIT_ADDRESS_MISMATCH');
  assert.strictEqual(unverified.json.credited, false);
  assert.strictEqual((await DepositRequest.findById(noAddress.id)).status, 'PENDING');
  assert.strictEqual(await balanceOf(db, userAId), beforeHttp);
  assert.strictEqual(await balanceOf(db, userBId), 3);

  await new Promise((resolve) => server.close(resolve));
  await closeDb().catch(() => {});
  console.log('test-deposit-wallet-credit: OK');
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
