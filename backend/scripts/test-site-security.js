#!/usr/bin/env node
/**
 * Site security hardening checks:
 * - AES-256-GCM sensitive field encrypt/decrypt
 * - Stripe webhook constructEvent signature reject/accept
 * - Helmet + rate-limit middleware export smoke
 *
 * Run: node backend/scripts/test-site-security.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function testSensitiveCrypto() {
  section('Sensitive data AES-256-GCM round-trip');
  const prevKey = process.env.SENSITIVE_DATA_ENCRYPTION_KEY;
  const prevNode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.SENSITIVE_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

  // Fresh require after env set
  delete require.cache[require.resolve('../src/services/sensitiveDataCrypto')];
  const {
    encryptField,
    decryptField,
    isEncrypted,
    maskSensitive,
    isEncryptionConfigured,
  } = require('../src/services/sensitiveDataCrypto');

  assert.strictEqual(isEncryptionConfigured(), true);
  const passport = 'MA1234567';
  const enc = encryptField(passport);
  assert.ok(isEncrypted(enc), 'ciphertext must use enc:v1: prefix');
  assert.notStrictEqual(enc, passport);
  assert.strictEqual(decryptField(enc), passport);
  assert.strictEqual(decryptField(passport), passport, 'legacy plaintext passthrough');
  assert.ok(maskSensitive(passport).endsWith('4567'));
  assert.ok(!maskSensitive(passport).includes('MA123'));

  // Idempotent encrypt
  assert.strictEqual(encryptField(enc), enc);

  // Wrong key must fail closed
  process.env.SENSITIVE_DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  delete require.cache[require.resolve('../src/services/sensitiveDataCrypto')];
  const crypto2 = require('../src/services/sensitiveDataCrypto');
  assert.throws(() => crypto2.decryptField(enc));

  if (prevKey === undefined) delete process.env.SENSITIVE_DATA_ENCRYPTION_KEY;
  else process.env.SENSITIVE_DATA_ENCRYPTION_KEY = prevKey;
  if (prevNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNode;
  console.log('ok');
}

async function testStripeWebhook() {
  section('Stripe webhook signature verification');
  const Stripe = require('stripe');
  const {
    constructStripeEvent,
    handleStripeWebhook,
    _resetStripeClientForTests,
  } = require('../src/services/stripeWebhookService');

  _resetStripeClientForTests();
  const prevWh = process.env.STRIPE_WEBHOOK_SECRET;
  const prevSk = process.env.STRIPE_SECRET_KEY;

  // Missing secret → fail closed
  delete process.env.STRIPE_WEBHOOK_SECRET;
  await assert.rejects(
    async () => constructStripeEvent({ headers: {}, rawBody: '{}' }),
    (err) => err.code === 'STRIPE_WEBHOOK_NOT_CONFIGURED'
  );

  // Generate a real Stripe test webhook secret + signed payload
  const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  _resetStripeClientForTests();

  const payload = JSON.stringify({
    id: 'evt_test_site_security',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test' } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', Buffer.from(secret.replace('whsec_', ''), 'base64') || Buffer.from(secret))
    .update(signedPayload)
    .digest('hex');

  // Prefer Stripe helper when available for correct whsec decoding
  let header;
  try {
    header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
  } catch {
    // Fallback manual header (may fail if whsec encoding differs)
    header = `t=${timestamp},v1=${signature}`;
  }

  // Fake signature must be rejected
  await assert.rejects(
    async () => constructStripeEvent({
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      rawBody: payload,
      rawBodyBuffer: Buffer.from(payload),
    }),
    (err) => err.code === 'STRIPE_WEBHOOK_INVALID_SIGNATURE'
  );

  // Missing signature rejected
  await assert.rejects(
    async () => constructStripeEvent({
      headers: {},
      rawBody: payload,
    }),
    (err) => err.code === 'STRIPE_WEBHOOK_INVALID_SIGNATURE'
  );

  // Valid signed event accepted
  const event = constructStripeEvent({
    headers: { 'stripe-signature': header },
    rawBody: payload,
    rawBodyBuffer: Buffer.from(payload),
  });
  assert.strictEqual(event.type, 'payment_intent.succeeded');

  const handled = await handleStripeWebhook({
    headers: { 'stripe-signature': header },
    rawBody: payload,
    rawBodyBuffer: Buffer.from(payload),
  });
  assert.strictEqual(handled.received, true);

  if (prevWh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = prevWh;
  if (prevSk === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevSk;
  _resetStripeClientForTests();
  console.log('ok');
}

async function testMiddleware() {
  section('Helmet + rate-limit middleware');
  const {
    createHelmetMiddleware,
    createApiRateLimiter,
    createAuthRateLimiter,
    createKycRateLimiter,
    isWebhookPath,
  } = require('../src/middleware/security');

  assert.strictEqual(typeof createHelmetMiddleware(), 'function');
  assert.strictEqual(typeof createApiRateLimiter(), 'function');
  assert.strictEqual(typeof createAuthRateLimiter(), 'function');
  assert.strictEqual(typeof createKycRateLimiter(), 'function');
  assert.ok(isWebhookPath({ originalUrl: '/api/webhook/stripe' }));
  assert.ok(!isWebhookPath({ originalUrl: '/api/auth/login' }));
  console.log('ok');
}

async function testAppBootHeaders() {
  section('Express app exports with security middleware');
  // Avoid binding a port — just require the app module
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const { app } = require('../src/index');
  assert.ok(app);
  assert.ok(Array.isArray(app._router?.stack) || app.router || app.handle);
  console.log('ok');
}

async function main() {
  await testSensitiveCrypto();
  await testStripeWebhook();
  await testMiddleware();
  await testAppBootHeaders();
  console.log('\nAll site-security checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
