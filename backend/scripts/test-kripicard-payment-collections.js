#!/usr/bin/env node
/**
 * Kripicard payment-collection webhook → Master Wallet credit.
 * Run: node backend/scripts/test-kripicard-payment-collections.js
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
  const webhook = read('backend/src/routes/webhook.js');
  const deposit = read('backend/src/routes/deposit.js');
  const service = read('backend/src/services/kripicardPaymentCollectionService.js');
  const migration = read('backend/migrations/064_kripicard_payment_collections.sql');
  const envExample = read('backend/.env.example');
  const apiIndex = read('backend/api/index.js');

  assert.ok(webhook.includes("router.post('/kripicard'"), 'webhook /kripicard');
  assert.ok(webhook.includes("router.post('/kripicard/collections'"), 'webhook /kripicard/collections');
  assert.ok(webhook.includes("router.post('/kripicard/payments'"), 'webhook /kripicard/payments');
  assert.ok(webhook.includes('handleKripicardPaymentWebhook'), 'webhook uses collection handler');
  assert.ok(deposit.includes('createKripicardCollectionDeposit'), 'deposit route creates collections');
  assert.ok(deposit.includes("/kripicard-collection'"), 'explicit deposit route');
  assert.ok(service.includes('creditDepositAndVerify'), 'credits via deposit verify');
  assert.ok(service.includes("ledger: 'master_wallet'"), 'master wallet ledger tag');
  assert.ok(service.includes('verifyKripicardWebhookSignature'), 'signature verify');
  assert.ok(migration.includes('kripicard_payment_events'), 'events table');
  const createdByMigration = read('backend/migrations/065_kripicard_collection_created_by.sql');
  assert.ok(createdByMigration.includes('kripicard_collection'), 'created_by allow-list');
  assert.ok(envExample.includes('KRIPICARD_WEBHOOK_SECRET'), 'env secret documented');
  assert.ok(apiIndex.includes('webhook/kripicard'), 'vercel entry documents webhook');
  console.log('ok');

  section('Parser + signature');
  const {
    parsePaymentCollectionEvent,
    verifyKripicardWebhookSignature,
    generateMerchantReference,
  } = require('../src/services/kripicardPaymentCollectionService');

  const paid = parsePaymentCollectionEvent({
    id: 'evt_1',
    type: 'payment_collection.paid',
    data: {
      id: 'col_abc',
      payment_id: 'pay_xyz',
      status: 'paid',
      amount: 25.5,
      currency: 'USDT',
      merchant_reference: 'KC123',
      metadata: { eisy_user_id: 42 },
    },
  });
  assert.strictEqual(paid.is_paid, true);
  assert.strictEqual(paid.collection_id, 'col_abc');
  assert.strictEqual(paid.payment_id, 'pay_xyz');
  assert.strictEqual(paid.merchant_reference, 'KC123');
  assert.strictEqual(paid.amount_usdt, 25.5);
  assert.strictEqual(paid.user_id, 42);

  const ignored = parsePaymentCollectionEvent({
    type: 'payment_collection.created',
    data: { id: 'col_pending', status: 'pending', amount: 10 },
  });
  assert.strictEqual(ignored.is_paid, false);

  const micro = parsePaymentCollectionEvent({
    type: 'payment.completed',
    data: { id: 'col_micro', status: 'completed', amount: 15000000 },
  });
  assert.strictEqual(micro.amount_usdt, 15);

  process.env.KRIPICARD_WEBHOOK_SECRET = 'test-secret-kripicard';
  const body = JSON.stringify({ type: 'payment_collection.paid', data: { id: 'c1', status: 'paid' } });
  const sig = crypto
    .createHmac('sha256', 'test-secret-kripicard')
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');
  const ok = verifyKripicardWebhookSignature({
    headers: { 'x-kripicard-signature': `sha256=${sig}` },
    rawBody: body,
    body: JSON.parse(body),
  });
  assert.strictEqual(ok.ok, true);

  let threw = false;
  try {
    verifyKripicardWebhookSignature({
      headers: { 'x-kripicard-signature': 'sha256=deadbeef' },
      rawBody: body,
      body: JSON.parse(body),
    });
  } catch (err) {
    threw = true;
    assert.strictEqual(err.code, 'KRIPICARD_WEBHOOK_INVALID_SIGNATURE');
  }
  assert.ok(threw, 'bad signature rejected');

  const ref = generateMerchantReference(7);
  assert.ok(/^KC/.test(ref), 'merchant ref prefix');
  console.log('ok');

  section('DB create + webhook credit Master Wallet');
  const dbFile = path.join(os.tmpdir(), `eisy-kripicard-pay-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.KRIPICARD_WEBHOOK_SECRET = 'test-secret-kripicard';
  process.env.KRIPICARD_QUERY_BEFORE_CREDIT = 'false';
  // Avoid live fee settings / supabase noise
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const table = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='kripicard_payment_events'"
  );
  assert.ok(table, 'migration applied kripicard_payment_events');

  const pinHash = require('../src/services/cryptoService').hashPin('123456');
  const userIns = await db.run(
    `INSERT INTO users (name, phone, email, email_verified, pin_hash, pin_set_at, balance_usdt, updated_at)
     VALUES (?, ?, ?, 1, ?, datetime('now'), 0, datetime('now'))`,
    'KC Pay User',
    '+959999000111',
    `kc-pay-${Date.now()}@test.local`,
    pinHash
  );
  const userId = userIns.lastID;

  const {
    createKripicardCollectionDeposit,
    handleKripicardPaymentWebhook,
  } = require('../src/services/kripicardPaymentCollectionService');

  const created = await createKripicardCollectionDeposit(userId, { amount_usdt: 20 });
  assert.ok(created.deposit?.id, 'deposit created');
  assert.ok(created.merchant_reference, 'merchant reference');
  assert.strictEqual(created.deposit.purpose || created.deposit.raw?.purpose || 'usdt_topup', 'usdt_topup');

  const DepositRequest = require('../src/models/DepositRequest');
  const pending = await DepositRequest.findById(created.deposit.id);
  assert.ok(pending, 'pending deposit in DB');
  assert.notStrictEqual(String(pending.status).toUpperCase(), 'VERIFIED');

  const payloadObj = {
    id: `evt_${Date.now()}`,
    type: 'payment_collection.paid',
    data: {
      id: 'col_live_1',
      payment_id: `pay_${Date.now()}`,
      status: 'paid',
      amount_usdt: Number(pending.amount_usd),
      currency: 'USDT',
      merchant_reference: created.merchant_reference,
    },
  };
  const payload = JSON.stringify(payloadObj);
  const goodSig = crypto
    .createHmac('sha256', 'test-secret-kripicard')
    .update(Buffer.from(payload, 'utf8'))
    .digest('hex');

  const creditResult = await handleKripicardPaymentWebhook({
    headers: { 'x-kripicard-signature': goodSig },
    rawBody: payload,
    body: payloadObj,
  });
  assert.strictEqual(creditResult.credited, true, 'first webhook credits');
  assert.strictEqual(creditResult.ledger, 'master_wallet');
  assert.ok(Number(creditResult.net_usdt) > 0, 'net credit positive');

  const userAfter = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.ok(
    Number(userAfter.balance_usdt) >= Number(creditResult.net_usdt) - 0.001,
    `Master Wallet credited (got ${userAfter.balance_usdt})`
  );

  const verified = await DepositRequest.findById(created.deposit.id);
  assert.strictEqual(String(verified.status).toUpperCase(), 'VERIFIED');

  const eventRow = await db.get(
    'SELECT * FROM kripicard_payment_events WHERE event_id = ?',
    payloadObj.id
  );
  assert.ok(eventRow, 'event persisted');
  assert.strictEqual(Number(eventRow.credited), 1);

  const replay = await handleKripicardPaymentWebhook({
    headers: { 'x-kripicard-signature': goodSig },
    rawBody: payload,
    body: payloadObj,
  });
  assert.strictEqual(replay.alreadyVerified, true, 'idempotent replay');

  const userReplay = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.strictEqual(
    Number(userReplay.balance_usdt),
    Number(userAfter.balance_usdt),
    'replay does not double-credit'
  );

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('ok');

  console.log('\nAll Kripicard payment-collection checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
