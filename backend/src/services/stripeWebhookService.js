/**
 * Stripe webhook intake with mandatory signature verification.
 * Rejects all unverified / fake requests (fail closed).
 *
 * Env:
 *   STRIPE_SECRET_KEY=sk_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 */

'use strict';

const Stripe = require('stripe');

let stripeClient = null;

function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
}

function getWebhookSecret() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

function isStripeWebhookConfigured() {
  const whsec = getWebhookSecret();
  return Boolean(whsec && whsec.startsWith('whsec_'));
}

function getStripe() {
  // constructEvent only needs the webhook secret; API key is optional for verification-only.
  const key = getStripeSecretKey() || 'sk_test_webhook_signature_verification_only';
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      maxNetworkRetries: 2,
    });
  }
  return stripeClient;
}

/**
 * Verify Stripe-Signature with constructEvent. Never trust req.body alone.
 * @returns {import('stripe').Stripe.Event}
 */
function constructStripeEvent(req) {
  const secret = getWebhookSecret();
  if (!secret || !secret.startsWith('whsec_')) {
    const err = new Error(
      'Stripe webhook secret missing or invalid. Set STRIPE_WEBHOOK_SECRET=whsec_...'
    );
    err.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const signature = req.headers['stripe-signature'] || req.headers['Stripe-Signature'];
  if (!signature) {
    const err = new Error('Missing Stripe-Signature header');
    err.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  const payload = req.rawBodyBuffer || req.rawBody;
  if (payload == null || payload === '') {
    const err = new Error('Missing raw request body required for Stripe signature verification');
    err.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }

  try {
    const stripe = getStripe();
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    const err = new Error(`Stripe webhook signature verification failed: ${e.message}`);
    err.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE';
    err.status = 401;
    throw err;
  }
}

/**
 * Process a verified Stripe event. Extend as payment products are wired.
 * Always ACK only after signature verification succeeds.
 */
async function handleStripeWebhookEvent(event) {
  const type = event?.type || 'unknown';
  const id = event?.id || null;

  switch (type) {
    case 'checkout.session.completed':
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'charge.refunded':
      console.log('[webhook/stripe] verified event', { id, type });
      break;
    default:
      console.log('[webhook/stripe] verified unhandled event', { id, type });
  }

  return {
    received: true,
    id,
    type,
  };
}

async function handleStripeWebhook(req) {
  const event = constructStripeEvent(req);
  return handleStripeWebhookEvent(event);
}

/** Test helper — reset singleton between unit tests. */
function _resetStripeClientForTests() {
  stripeClient = null;
}

module.exports = {
  getStripe,
  getWebhookSecret,
  isStripeWebhookConfigured,
  constructStripeEvent,
  handleStripeWebhookEvent,
  handleStripeWebhook,
  _resetStripeClientForTests,
};
