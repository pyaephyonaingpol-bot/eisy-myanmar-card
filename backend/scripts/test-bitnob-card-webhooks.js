#!/usr/bin/env node
/**
 * Bitnob webhook signature + async event handling (Step 1).
 * Does not call live Bitnob APIs — mocks getCardDetails where needed.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function signBody(secret, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    raw,
    signature: crypto.createHmac('sha512', secret).update(Buffer.from(raw, 'utf8')).digest('hex'),
  };
}

function testSignatureVerification() {
  section('verifyBitnobWebhookSignature HMAC-SHA512');
  process.env.BITNOB_WEBHOOK_SECRET = 'whsec-test-secret';
  delete require.cache[require.resolve('../src/services/bitnobCardWebhookService')];
  const {
    verifyBitnobWebhookSignature,
  } = require('../src/services/bitnobCardWebhookService');

  const payload = { event: 'virtualcard.created.completed', eventId: 'evt_1', data: { card: { id: 'c1' } } };
  const { raw, signature } = signBody(process.env.BITNOB_WEBHOOK_SECRET, payload);

  verifyBitnobWebhookSignature({
    headers: { 'x-bitnob-signature': signature },
    rawBody: raw,
  });

  let failed = false;
  try {
    verifyBitnobWebhookSignature({
      headers: { 'x-bitnob-signature': 'deadbeef' },
      rawBody: raw,
    });
  } catch (err) {
    failed = true;
    assert.strictEqual(err.code, 'BITNOB_WEBHOOK_INVALID_SIGNATURE');
  }
  assert.ok(failed, 'bad signature must fail');
  console.log('ok');
}

async function testCreatedCompletedPromotesPendingCard() {
  section('virtualcard.created.completed promotes pending cards_v2 row');
  process.env.BITNOB_WEBHOOK_SECRET = 'whsec-test-secret';
  process.env.BITNOB_CLIENT_ID = 'cid';
  process.env.BITNOB_CLIENT_SECRET = 'csec';

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  delete require.cache[require.resolve('../src/services/bitnobCardWebhookService')];
  delete require.cache[require.resolve('../src/services/bitnobService')];

  // Mock getCardDetails used after webhook
  const bitnobPath = path.join(__dirname, '../src/services/bitnobService');
  const originalBitnob = require.cache[require.resolve(bitnobPath)];
  require.cache[require.resolve(bitnobPath)] = {
    id: bitnobPath,
    filename: bitnobPath,
    loaded: true,
    exports: {
      async getCardDetails() {
        return {
          card: {
            provider: 'bitnob',
            card_id: 'bn-card-100',
            status: 'active',
            created_status: 'completed',
            masked_pan: '**** **** **** 4242',
            balance_usd: 25,
            name: 'Test User',
          },
          raw: {},
        };
      },
      microunitsToUsd(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n / 1e6 : null;
      },
      normalizeBitnobCard(c) {
        return c;
      },
    },
  };
  delete require.cache[require.resolve('../src/services/bitnobCardWebhookService')];

  const Card = require('../src/models/Card');
  const User = require('../src/models/User');
  const {
    processBitnobCardWebhook,
    resetBitnobWebhookDedupeForTests,
    handleBitnobCardWebhook,
  } = require('../src/services/bitnobCardWebhookService');

  resetBitnobWebhookDedupeForTests();

  let user = await User.findByEmail('bitnob-webhook-test@example.com');
  if (!user) {
    user = await User.create({
      name: 'Webhook Tester',
      phone: `+959${Date.now().toString().slice(-8)}`,
      email: 'bitnob-webhook-test@example.com',
      pinHash: 'test-pin-hash',
    });
  }

  const pending = await Card.requestPending({
    userId: user.id,
    cardHolderName: 'Webhook Tester',
    userNote: 'awaiting Bitnob',
    metadata: {
      provider: 'bitnob',
      provider_card_id: 'bn-card-100',
      request_status: 'pending_provider_details',
    },
  });
  assert.strictEqual(pending.status, 'pending');

  const eventBody = {
    event: 'virtualcard.created.completed',
    eventId: `evt_create_${Date.now()}`,
    data: {
      card: {
        id: 'bn-card-100',
        status: 'active',
        masked_pan: '**** **** **** 4242',
        balance_amount: '25000000',
        display_amount: 25,
      },
    },
  };

  const result = await processBitnobCardWebhook(eventBody);
  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.card_id, pending.id);

  const updated = await Card.findById(pending.id);
  assert.strictEqual(updated.status, 'active');
  assert.ok(String(updated.card_number).includes('4242'));
  const meta = JSON.parse(updated.metadata);
  assert.strictEqual(meta.created_status, 'completed');
  assert.strictEqual(meta.activated_via, 'bitnob_webhook');

  // Duplicate eventId must be idempotent
  const dup = await processBitnobCardWebhook(eventBody);
  assert.strictEqual(dup.duplicate, true);

  // Full HTTP handler path with signature
  const { raw, signature } = signBody(process.env.BITNOB_WEBHOOK_SECRET, {
    event: 'virtualcard.topup.completed',
    eventId: `evt_topup_${Date.now()}`,
    data: {
      cardId: 'bn-card-100',
      amount: 5000000,
      display_amount: 30,
      reference: 'BN_FUND_TEST',
      card: { id: 'bn-card-100', balance_amount: '30000000', display_amount: 30 },
    },
  });
  const topup = await handleBitnobCardWebhook({
    headers: { 'x-bitnob-signature': signature },
    rawBody: raw,
    body: JSON.parse(raw),
  });
  assert.strictEqual(topup.handled, true);
  assert.strictEqual(topup.event, 'virtualcard.topup.completed');

  const afterTopup = await Card.findById(pending.id);
  const meta2 = JSON.parse(afterTopup.metadata);
  assert.strictEqual(meta2.last_fund_status, 'completed');
  assert.ok(meta2.balance_usd === 25 || meta2.balance_usd === 30);

  // restore bitnob module
  if (originalBitnob) {
    require.cache[require.resolve(bitnobPath)] = originalBitnob;
  } else {
    delete require.cache[require.resolve(bitnobPath)];
  }
  delete require.cache[require.resolve('../src/services/bitnobCardWebhookService')];

  console.log('ok');
}

function testRouteWiring() {
  section('webhook + user sync routes wired');
  const fs = require('fs');
  const webhook = fs.readFileSync(path.join(__dirname, '../src/routes/webhook.js'), 'utf8');
  assert.ok(webhook.includes("/bitnob/cards"));
  assert.ok(webhook.includes('handleBitnobCardWebhook'));
  const user = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
  assert.ok(user.includes("/cards/:id/sync"));
  assert.ok(user.includes('syncBitnobCardFromProvider'));
  console.log('ok');
}

async function main() {
  testRouteWiring();
  testSignatureVerification();
  await testCreatedCompletedPromotesPendingCard();
  console.log('\nBitnob webhook / polling Step 1 checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
