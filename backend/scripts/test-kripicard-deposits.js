#!/usr/bin/env node
/**
 * Kripicard Deposit API → Master Wallet credit.
 * Run: node backend/scripts/test-kripicard-deposits.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('Static wiring');
  const depositRoutes = read('backend/src/routes/deposit.js');
  const tronRoutes = read('backend/src/routes/tronOrders.js');
  const webhook = read('backend/src/routes/webhook.js');
  const indexJs = read('backend/src/index.js');
  const lib = read('lib/kripicard.js');
  const envExample = read('backend/.env.example');

  assert.ok(lib.includes('createDeposit'), 'lib createDeposit');
  assert.ok(lib.includes('getDepositStatus'), 'lib getDepositStatus');
  assert.ok(lib.includes('fetchDepositNetworks'), 'lib networks');
  assert.ok(lib.includes('/api/external/deposits/create'), 'create URL');
  assert.ok(depositRoutes.includes('createKripicardCryptoDeposit'), 'deposit/create uses Kripicard');
  assert.ok(!depositRoutes.includes('createBinancePayDeposit'), 'Binance create removed from deposit routes');
  assert.ok(!depositRoutes.includes('createUsdtDepositRequest'), 'legacy HD create removed from deposit routes');
  assert.ok(tronRoutes.includes('createKripicardCryptoDeposit'), 'tron/orders → Kripicard');
  assert.ok(webhook.includes('handleKripicardDepositWebhook'), 'deposit webhook');
  assert.ok(webhook.includes("/kripicard/deposits'"), 'deposits webhook path');
  assert.ok(indexJs.includes('startKripicardDepositPoller'), 'poller started');
  assert.ok(envExample.includes('KRIPICARD_DEPOSITS_CREATE_URL'), 'env documented');
  console.log('ok');

  section('Network aliases');
  const {
    normalizeDepositNetwork,
    toLocalUsdtNetwork,
    normalizeDepositRecord,
  } = require('../../lib/kripicard');
  assert.strictEqual(normalizeDepositNetwork('TRC20'), 'tron');
  assert.strictEqual(normalizeDepositNetwork('BEP20'), 'bsc');
  assert.strictEqual(normalizeDepositNetwork('tron'), 'tron');
  assert.strictEqual(toLocalUsdtNetwork('tron'), 'TRC20');
  assert.strictEqual(toLocalUsdtNetwork('bsc'), 'BEP20');
  assert.strictEqual(toLocalUsdtNetwork('eth'), null);

  const parsed = normalizeDepositRecord({
    success: true,
    data: {
      id: 'ABC123',
      status: 'pending',
      amount_usd: 20,
      fee_usd: 0.2,
      credited_on_completion_usd: 19.8,
      pay_address: 'TADDR',
      pay_amount: '20.00',
      pay_currency: 'USDT',
      network: 'tron',
    },
  });
  assert.strictEqual(parsed.id, 'ABC123');
  assert.strictEqual(parsed.pay_address, 'TADDR');
  assert.strictEqual(parsed.network, 'tron');
  assert.strictEqual(parsed.credited_on_completion_usd, 19.8);
  console.log('ok');

  section('Create + webhook credit (mocked provider)');
  const dbFile = path.join(os.tmpdir(), `eisy-kripicard-dep-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.KRIPICARD_API_KEY = 'test-key-not-used-live';
  process.env.KRIPICARD_WEBHOOK_SECRET = 'dep-secret';
  process.env.KRIPICARD_QUERY_BEFORE_CREDIT = 'false';
  process.env.KRIPICARD_DEPOSIT_POLL_ENABLED = 'false';
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';

  // Stub lib/kripicard deposit calls before service load.
  const kripicardPath = require.resolve('../../lib/kripicard');
  const realKripicard = require(kripicardPath);
  const providerState = {
    id: 'DEPTEST001',
    status: 'pending',
    amount_usd: 20,
    fee_usd: 0.2,
    credited_on_completion_usd: 19.8,
    pay_address: 'TPayToAddressUnique001',
    pay_amount: '20.00',
    pay_currency: 'USDT',
    network: 'tron',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    credited: false,
    credited_amount_usd: 0,
    order_id: null,
    raw: {},
  };

  require.cache[kripicardPath].exports = {
    ...realKripicard,
    createDeposit: async ({ amount, network, orderId }) => {
      providerState.order_id = orderId || null;
      providerState.amount_usd = Number(amount);
      providerState.network = realKripicard.normalizeDepositNetwork(network);
      providerState.raw = { ...providerState };
      return { ...providerState, raw: { data: { ...providerState } } };
    },
    getDepositStatus: async () => ({
      ...providerState,
      raw: { data: { ...providerState } },
    }),
    fetchDepositNetworks: async () => ({
      currency: 'USDT',
      networks: [{ network: 'tron', name: 'TRON', min_amount: 1 }],
      raw: {},
    }),
  };

  // Clear dependent modules so they pick up the stub.
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}kripicardDepositService.js`)
      || key.includes(`${path.sep}kripicardPaymentCollectionService.js`)
      || key.includes(`${path.sep}depositService.js`)
    ) {
      delete require.cache[key];
    }
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const pinHash = require('../src/services/cryptoService').hashPin('123456');
  const userIns = await db.run(
    `INSERT INTO users (name, phone, email, email_verified, pin_hash, pin_set_at, balance_usdt, updated_at)
     VALUES (?, ?, ?, 1, ?, datetime('now'), 0, datetime('now'))`,
    'KC Dep User',
    '+959888777666',
    `kc-dep-${Date.now()}@test.local`,
    pinHash
  );
  const userId = userIns.lastID;

  const {
    createKripicardCryptoDeposit,
    handleKripicardDepositWebhook,
    findOrderByOrderId,
  } = require('../src/services/kripicardDepositService');

  const created = await createKripicardCryptoDeposit(userId, {
    amount_usdt: 20,
    network: 'TRC20',
    order_id: 'OID-TEST-1',
  });
  assert.ok(created.order?.deposit_address, 'unique pay address');
  assert.strictEqual(created.order.deposit_address, 'TPayToAddressUnique001');
  assert.strictEqual(created.payment.kripicard_network, 'tron');
  assert.ok(created.order.order_id, 'order_id present');
  assert.strictEqual(Number(created.fee_breakdown.net_usdt), 19.8);

  // Mark provider completed, then webhook.
  providerState.status = 'completed';
  providerState.credited = true;
  providerState.credited_amount_usd = 19.8;

  const payloadObj = {
    id: `evt_dep_${Date.now()}`,
    type: 'deposit.completed',
    data: {
      id: providerState.id,
      status: 'completed',
      credited: true,
      credited_amount_usd: 19.8,
      fee_usd: 0.2,
      amount_usd: 20,
      pay_address: providerState.pay_address,
      pay_amount: '20.00',
      network: 'tron',
      order_id: 'OID-TEST-1',
    },
  };
  const payload = JSON.stringify(payloadObj);
  const sig = crypto.createHmac('sha256', 'dep-secret').update(payload).digest('hex');

  const credit = await handleKripicardDepositWebhook({
    headers: { 'x-kripicard-signature': sig },
    rawBody: payload,
    body: payloadObj,
  });
  assert.strictEqual(credit.credited, true, 'webhook credits wallet');
  assert.strictEqual(credit.ledger, 'master_wallet');

  const userAfter = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.ok(Number(userAfter.balance_usdt) >= 19.8 - 0.001, `balance=${userAfter.balance_usdt}`);

  const order = await findOrderByOrderId('OID-TEST-1');
  assert.ok(order, 'order lookup');
  assert.strictEqual(order.status, 'COMPLETED');

  const replay = await handleKripicardDepositWebhook({
    headers: { 'x-kripicard-signature': sig },
    rawBody: payload,
    body: payloadObj,
  });
  assert.strictEqual(replay.alreadyVerified, true);
  const userReplay = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.strictEqual(Number(userReplay.balance_usdt), Number(userAfter.balance_usdt));

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }

  // Restore lib
  require.cache[kripicardPath].exports = realKripicard;
  console.log('ok');
  console.log('\nAll Kripicard Deposit API checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
