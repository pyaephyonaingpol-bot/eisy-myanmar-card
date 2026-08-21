#!/usr/bin/env node
/**
 * NOWPayments payout env / fail-closed behaviour.
 * Run: node backend/scripts/test-nowpayments-payout-config.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function clearPayoutEnv() {
  for (const key of [
    'NOWPAYMENTS_API_KEY',
    'NOWPAYMENTS_EMAIL',
    'NOWPAYMENTS_PASSWORD',
    'NOWPAYMENTS_IPN_SECRET',
    'NOWPAYMENTS_PAYOUTS_ENABLED',
    'NOWPAYMENTS_REQUIRE_LIVE_PAYOUT',
    'NOWPAYMENTS_PAYOUT_2FA_SECRET',
    'NOWPAYMENTS_PAYOUT_VERIFICATION_CODE',
    'USDT_AUTO_WITHDRAW_ENABLED',
    'PUBLIC_BASE_URL',
    'VERCEL',
    'VERCEL_ENV',
    'NODE_ENV',
  ]) {
    delete process.env[key];
  }
}

async function main() {
  clearPayoutEnv();
  process.env.NODE_ENV = 'test';

  // Fresh require after env clear
  delete require.cache[require.resolve('../src/services/nowPaymentsPayoutService')];
  delete require.cache[require.resolve('../src/services/nowPaymentsService')];

  let {
    getNowPaymentsPayoutConfigStatus,
    isLivePayoutRequired,
    assertNowPaymentsPayoutsReady,
    isNowPaymentsPayoutsEnabled,
  } = require('../src/services/nowPaymentsPayoutService');

  assert.strictEqual(isLivePayoutRequired(), false, 'not required in test without VERCEL');
  assert.strictEqual(isNowPaymentsPayoutsEnabled(), false);

  process.env.VERCEL = '1';
  delete require.cache[require.resolve('../src/services/nowPaymentsPayoutService')];
  ({
    getNowPaymentsPayoutConfigStatus,
    isLivePayoutRequired,
    assertNowPaymentsPayoutsReady,
    isNowPaymentsPayoutsEnabled,
  } = require('../src/services/nowPaymentsPayoutService'));

  assert.strictEqual(isLivePayoutRequired(), true, 'Vercel defaults to require live');
  assert.throws(
    () => assertNowPaymentsPayoutsReady(),
    (err) => err.code === 'NOWPAYMENTS_PAYOUT_CONFIG_INCOMPLETE'
  );

  process.env.NOWPAYMENTS_API_KEY = 'k';
  process.env.NOWPAYMENTS_EMAIL = 'a@b.c';
  process.env.NOWPAYMENTS_PASSWORD = 'secret';
  process.env.NOWPAYMENTS_IPN_SECRET = 'ipn';
  process.env.PUBLIC_BASE_URL = 'https://example.com';
  process.env.NOWPAYMENTS_PAYOUTS_ENABLED = 'true';

  delete require.cache[require.resolve('../src/services/nowPaymentsPayoutService')];
  delete require.cache[require.resolve('../src/services/nowPaymentsService')];
  ({
    getNowPaymentsPayoutConfigStatus,
    assertNowPaymentsPayoutsReady,
  } = require('../src/services/nowPaymentsPayoutService'));

  const status = getNowPaymentsPayoutConfigStatus();
  assert.strictEqual(status.ready, true);
  assert.strictEqual(status.require_live, true);
  assert.deepStrictEqual(status.missing, []);
  assertNowPaymentsPayoutsReady();

  process.env.NOWPAYMENTS_REQUIRE_LIVE_PAYOUT = 'false';
  delete require.cache[require.resolve('../src/services/nowPaymentsPayoutService')];
  ({ isLivePayoutRequired } = require('../src/services/nowPaymentsPayoutService'));
  assert.strictEqual(isLivePayoutRequired(), false);

  console.log('test-nowpayments-payout-config: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
