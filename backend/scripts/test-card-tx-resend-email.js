#!/usr/bin/env node
/**
 * Card transaction Approved/Declined Resend emails + webhook mapping.
 * Run: node backend/scripts/test-card-tx-resend-email.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('Source wiring');
  const emailSrc = fs.readFileSync(path.join(__dirname, '../src/services/emailService.js'), 'utf8');
  assert.ok(emailSrc.includes('sendCardTransactionEmail'), 'sendCardTransactionEmail');
  assert.ok(emailSrc.includes('dispatchCardTransactionEmail'), 'dispatch');
  assert.ok(emailSrc.includes('card-txn|'), 'idempotency key prefix');
  assert.ok(emailSrc.includes('Idempotency-Key') || emailSrc.includes('idempotencyKey'), 'Resend idempotency');

  const serviceSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/pago3dsWebhookService.js'),
    'utf8'
  );
  assert.ok(serviceSrc.includes('deliverCardTransactionNotifications'), 'deliver helper');
  assert.ok(serviceSrc.includes('dispatchCardTransactionEmail'), 'queues card txn email');
  assert.ok(serviceSrc.includes('event.transactionOutcome'), 'checks outcome');

  const cjs = fs.readFileSync(path.join(__dirname, '../../lib/pagocardsWebhook.cjs'), 'utf8');
  assert.ok(cjs.includes('function mapTransactionOutcome'), 'outcome mapper');
  assert.ok(cjs.includes('transactionOutcome'), 'normalizer field');
  console.log('ok');

  section('Normalizer: approved / declined (not 3DS / not card lifecycle)');
  const {
    normalizePagocardsWebhook,
    mapTransactionOutcome,
  } = require('../../lib/pagocardsWebhook.cjs');

  const approved = normalizePagocardsWebhook({
    eventId: 'txn-ok-1',
    eventType: 'transaction.completed',
    cardId: 'card_tx_1',
    status: 'approved',
    merchantName: 'Coffee Shop',
    transactionAmount: '12.50',
    transactionCurrency: 'USD',
    last4: '4242',
    occurred_at: '2026-11-20T01:00:00Z',
  });
  assert.ok(approved);
  assert.strictEqual(approved.is3ds, false);
  assert.strictEqual(approved.localStatus, null);
  assert.strictEqual(approved.transactionOutcome, 'approved');
  assert.strictEqual(approved.merchantName, 'Coffee Shop');
  assert.strictEqual(approved.last4, '4242');

  const declined = normalizePagocardsWebhook({
    eventId: 'txn-bad-1',
    type: 'payment.failed',
    card_id: 'card_tx_2',
    transaction_status: 'declined',
    merchant_name: 'Airline',
    transaction_amount: '199.00',
    transaction_currency: 'USD',
    decline_reason: 'Insufficient funds',
  });
  assert.ok(declined);
  assert.strictEqual(declined.transactionOutcome, 'declined');
  assert.strictEqual(declined.declineReason, 'Insufficient funds');
  assert.strictEqual(declined.localStatus, null);

  // Nested envelope
  const nested = normalizePagocardsWebhook({
    type: 'transaction',
    data: {
      id: 'nested-tx-9',
      status: 'failed',
      amount: { amount: '5.00', currency: 'USD' },
      merchant: { name: 'Kiosk' },
      card: { cardId: 'card_nested_tx', last4: '1111' },
      reason: 'Do not honor',
    },
  });
  assert.ok(nested);
  assert.strictEqual(nested.transactionOutcome, 'declined');
  assert.strictEqual(nested.merchantName, 'Kiosk');
  assert.strictEqual(nested.declineReason, 'Do not honor');

  // 3DS must not become a txn email outcome
  const threeDs = normalizePagocardsWebhook({
    eventId: '3ds-keep',
    eventType: '3ds',
    otp: '123456',
    cardid: 'card_3ds',
    status: 'approved',
    merchantName: 'Shop',
    transactionAmount: '10',
  });
  assert.strictEqual(threeDs.is3ds, true);
  assert.strictEqual(threeDs.transactionOutcome, null);

  // Card freeze must not become a txn email
  const frozen = normalizePagocardsWebhook({
    eventId: 'st-frozen-tx',
    eventType: 'card.status',
    cardId: 'card_freeze',
    status: 'frozen',
  });
  assert.strictEqual(frozen.localStatus, 'frozen');
  assert.strictEqual(frozen.transactionOutcome, null);

  assert.strictEqual(
    mapTransactionOutcome('approved', 'transaction.completed', { merchantName: 'X' }),
    'approved'
  );
  assert.strictEqual(
    mapTransactionOutcome('declined', 'payment', { transactionAmount: '1' }),
    'declined'
  );
  assert.strictEqual(
    mapTransactionOutcome('frozen', 'card.status', {}),
    null
  );
  console.log('ok');

  section('Email builders + send (no API key → console)');
  const {
    sendCardTransactionEmail,
    buildCardTransactionHtml,
    buildCardTransactionText,
    normalizeCardTxnOutcome,
    awaitPendingOtpEmails,
    dispatchCardTransactionEmail,
  } = require('../src/services/emailService');

  assert.strictEqual(normalizeCardTxnOutcome('approved'), 'approved');
  assert.strictEqual(normalizeCardTxnOutcome('failed'), 'declined');
  assert.strictEqual(normalizeCardTxnOutcome('pending'), null);

  const html = buildCardTransactionHtml({
    userName: 'Kim',
    outcome: 'declined',
    amountLabel: '19.99 USD',
    merchantName: 'Store',
    maskedCard: '•••• 4242',
    cardId: null,
    occurredAt: '2026-11-20T01:00:00Z',
    declineReason: 'Do not honor',
  });
  assert.ok(html.includes('Declined'));
  assert.ok(html.includes('Do not honor'));
  assert.ok(!html.includes('4111111111111111'));
  assert.ok(!/cvv/i.test(html));

  const text = buildCardTransactionText({
    userName: 'Kim',
    outcome: 'approved',
    amountLabel: '5 USD',
    merchantName: 'Cafe',
    maskedCard: '•••• 1111',
    cardId: null,
    occurredAt: null,
    declineReason: null,
  });
  assert.ok(text.includes('Approved'));
  assert.ok(text.includes('Cafe'));

  delete process.env.RESEND_API_KEY;
  const logged = await sendCardTransactionEmail({
    email: 'cardholder@example.com',
    userName: 'Kim',
    outcome: 'approved',
    amount: '12.50',
    currency: 'USD',
    merchantName: 'Coffee Shop',
    last4: '4242',
    eventId: 'txn-ok-1',
  });
  assert.strictEqual(logged.sent, false);
  assert.strictEqual(logged.reason, 'resend_not_configured');

  // Fake Resend success with idempotency header captured
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_test_1' }),
    };
  };
  try {
    const sent = await sendCardTransactionEmail({
      email: 'cardholder@example.com',
      outcome: 'declined',
      amount: '9',
      currency: 'USD',
      merchantName: 'Shop',
      last4: '9999',
      declineReason: 'Insufficient funds',
      eventId: 'txn-bad-1',
    });
    assert.strictEqual(sent.sent, true);
    assert.strictEqual(sent.provider, 'resend');
    assert.ok(calls.length >= 1);
    const last = calls[calls.length - 1];
    assert.ok(last.headers['Idempotency-Key'], 'idempotency header set');
    const body = JSON.parse(last.body);
    assert.ok(String(body.subject).includes('declined') || String(body.subject).includes('Declined'));
    assert.ok(!String(body.html).includes('cvv'), 'no cvv in html');
    assert.ok(String(body.html).includes('Insufficient funds'));

    // Dispatch never throws even if Resend fails
    global.fetch = async () => {
      throw new Error('network down');
    };
    const queued = dispatchCardTransactionEmail({
      email: 'cardholder@example.com',
      outcome: 'approved',
      amount: '1',
      currency: 'USD',
      eventId: 'txn-dispatch-fail',
    });
    assert.strictEqual(queued.queued, true);
    const results = await awaitPendingOtpEmails();
    assert.ok(results.some((r) => r && r.sent === false));
  } finally {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  }
  console.log('ok');

  section('Webhook handler: email once, duplicate suppressed');
  const dbFile = path.join(os.tmpdir(), `eisy-card-tx-email-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.DATABASE_AUTH_TOKEN = '';
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';

  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  const { initDb, closeDb } = require('../src/db');
  const User = require('../src/models/User');
  const Card = require('../src/models/Card');
  const {
    handlePagocardsWebhook,
    resetPagocardsWebhookLibCache,
  } = require('../src/services/pago3dsWebhookService');
  const { awaitPendingOtpEmails: awaitMail } = require('../src/services/emailService');

  await initDb();
  resetSupabaseClientForTests();
  resetPagocardsWebhookLibCache();
  const stamp = Date.now();
  const user = await User.create({
    name: 'Card Tx User',
    phone: `8${String(stamp).slice(-9)}`,
    email: `card-tx-${stamp}@example.com`,
    pinHash: null,
  });
  const pagoId = `card_tx_email_${stamp}`;
  await Card.createFromPago({
    userId: user.id,
    pagoCardId: pagoId,
    status: 'active',
    pagoStatus: 'normal',
    lastFour: '1111',
  });

  const mailCalls = [];
  global.fetch = async (url, init = {}) => {
    if (String(url).includes('resend.com')) {
      mailCalls.push(JSON.parse(init.body || '{}'));
      return { ok: true, status: 200, json: async () => ({ id: `em_${mailCalls.length}` }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const first = await handlePagocardsWebhook({
    eventId: `txn-webhook-1-${stamp}`,
    eventType: 'transaction.completed',
    cardId: pagoId,
    status: 'approved',
    merchantName: 'Market',
    transactionAmount: '8.00',
    transactionCurrency: 'USD',
  });
  assert.strictEqual(first.saved, true);
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(first.transactionOutcome, 'approved');
  await awaitMail();
  assert.strictEqual(mailCalls.length, 1, 'first webhook sends one email');

  const second = await handlePagocardsWebhook({
    eventId: `txn-webhook-1-${stamp}`,
    eventType: 'transaction.completed',
    cardId: pagoId,
    status: 'approved',
    merchantName: 'Market',
    transactionAmount: '8.00',
    transactionCurrency: 'USD',
  });
  assert.strictEqual(second.duplicate, true);
  await awaitMail();
  assert.strictEqual(mailCalls.length, 1, 'duplicate webhook must not re-email');

  const declinedWh = await handlePagocardsWebhook({
    eventId: `txn-webhook-2-${stamp}`,
    eventType: 'transaction.declined',
    cardId: pagoId,
    status: 'declined',
    merchantName: 'Market',
    transactionAmount: '50.00',
    transactionCurrency: 'USD',
    decline_reason: 'Insufficient funds',
  });
  assert.strictEqual(declinedWh.transactionOutcome, 'declined');
  await awaitMail();
  assert.strictEqual(mailCalls.length, 2, 'declined event sends separately');
  assert.ok(
    String(mailCalls[1].html || '').includes('Insufficient funds')
      || String(mailCalls[1].text || '').includes('Insufficient funds')
  );

  // 3DS still emails OTP path, not card-txn approved
  const before3ds = mailCalls.length;
  await handlePagocardsWebhook({
    eventId: `txn-webhook-3ds-${stamp}`,
    eventType: '3ds',
    otp: '654321',
    cardid: pagoId,
    merchantName: 'Market',
    transactionAmount: '3.00',
    transactionCurrency: 'USD',
  });
  await awaitMail();
  assert.ok(mailCalls.length > before3ds, '3DS still sends email');
  const last3ds = mailCalls[mailCalls.length - 1];
  assert.ok(
    String(last3ds.subject || '').toLowerCase().includes('3d')
      || String(last3ds.html || '').includes('654321'),
    '3DS email remains OTP-shaped'
  );

  console.log('ok');
  await closeDb();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* ignore */ }
  }
  console.log('\ncard-tx-resend-email: ok');
}

main().catch(async (err) => {
  console.error('card-tx-resend-email: FAIL', err);
  try {
    const { closeDb } = require('../src/db');
    await closeDb();
  } catch (_) { /* ignore */ }
  process.exit(1);
});
