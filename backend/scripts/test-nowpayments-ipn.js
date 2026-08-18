#!/usr/bin/env node
/**
 * NOWPayments IPN signature verification smoke test.
 * Run: node backend/scripts/test-nowpayments-ipn.js
 */
'use strict';

const assert = require('assert');
const {
  sortObjectDeep,
  verifyNowPaymentsSignature,
} = require('../src/services/nowPaymentsService');

function main() {
  const secret = 'test-ipn-secret-key';
  process.env.NOWPAYMENTS_IPN_SECRET = secret;

  const payload = {
    payment_id: 123456789,
    payment_status: 'finished',
    pay_amount: 50,
    pay_currency: 'usdt',
    order_id: 'order-abc',
  };

  const sorted = sortObjectDeep(payload);
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha512', secret)
    .update(JSON.stringify(sorted))
    .digest('hex');

  assert.ok(verifyNowPaymentsSignature(payload, sig), 'valid signature must pass');
  assert.ok(!verifyNowPaymentsSignature(payload, 'bad-signature'), 'invalid signature must fail');
  assert.ok(!verifyNowPaymentsSignature(payload, null), 'missing signature must fail');

  delete process.env.NOWPAYMENTS_IPN_SECRET;
  console.log('NOWPayments IPN signature checks passed.');
}

main();
