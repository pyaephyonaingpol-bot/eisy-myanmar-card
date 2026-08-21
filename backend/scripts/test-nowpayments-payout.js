#!/usr/bin/env node
/**
 * NOWPayments mass-payout (USDT withdrawal) smoke tests.
 * Run: node backend/scripts/test-nowpayments-payout.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function signIpn(payload, secret) {
  const { sortObjectDeep } = require('../src/services/nowPaymentsService');
  return crypto.createHmac('sha512', secret)
    .update(JSON.stringify(sortObjectDeep(payload)))
    .digest('hex');
}

async function main() {
  section('payout currency + TOTP helpers');
  const {
    payoutCurrencyForNetwork,
    generateTotpCode,
    isPayoutIpnPayload,
    resetNowPaymentsPayoutAuthCacheForTests,
  } = require('../src/services/nowPaymentsPayoutService');

  assert.strictEqual(payoutCurrencyForNetwork('TRC20'), 'usdttrc20');
  assert.strictEqual(payoutCurrencyForNetwork('BEP20'), 'usdtbsc');
  assert.strictEqual(payoutCurrencyForNetwork('ERC20'), null);

  // Known RFC 6238 test vector (secret "TESTSECRET234567" is arbitrary — just ensure length)
  const code = generateTotpCode('JBSWY3DPEHPK3PXP', { nowMs: 0 });
  assert.ok(code && /^\d{6}$/.test(code), 'TOTP must return 6 digits');

  assert.ok(isPayoutIpnPayload({ id: 'batch1', status: 'FINISHED' }));
  assert.ok(isPayoutIpnPayload({ batch_withdrawal_id: 'b1', status: 'FAILED' }));
  assert.ok(!isPayoutIpnPayload({ payment_id: 1, payment_status: 'finished', order_id: 'NP1' }));
  console.log('ok');

  section('create payout + IPN finish without live NOWPayments');
  resetNowPaymentsPayoutAuthCacheForTests();

  const dbFile = path.join(os.tmpdir(), `eisy-nowpayments-payout-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.PUBLIC_BASE_URL = 'https://example.test';
  process.env.NOWPAYMENTS_API_KEY = 'test-nowpayments-api-key';
  process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret-key';
  process.env.NOWPAYMENTS_EMAIL = 'merchant@example.com';
  process.env.NOWPAYMENTS_PASSWORD = 'secret-password';
  process.env.NOWPAYMENTS_PAYOUTS_ENABLED = 'true';
  delete process.env.NOWPAYMENTS_PAYOUT_2FA_SECRET;
  delete process.env.NOWPAYMENTS_PAYOUT_VERIFICATION_CODE;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  // Clear supabase so deposit path is unused
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 100)`,
    'Payout Test',
    phone
  );
  const userId = Number(userIns.lastID);

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method, body, headers: options.headers || {} });

    if (String(url).endsWith('/auth') && method === 'POST') {
      return { ok: true, json: async () => ({ token: 'test-jwt-token' }) };
    }
    if (String(url).endsWith('/payout') && method === 'POST') {
      assert.ok(options.headers.Authorization === 'Bearer test-jwt-token', 'payout requires JWT');
      assert.ok(options.headers['x-api-key'], 'payout requires api key');
      assert.strictEqual(body.withdrawals[0].currency, 'usdttrc20');
      assert.strictEqual(body.withdrawals[0].address.startsWith('T'), true);
      assert.ok(body.withdrawals[0].amount > 0);
      assert.ok(!('usdt_network' in body) && !('network' in (body.withdrawals[0] || {})));
      return {
        ok: true,
        json: async () => ({
          id: 'batch-payout-001',
          withdrawals: [{
            id: 'wd-item-001',
            address: body.withdrawals[0].address,
            currency: 'usdttrc20',
            amount: body.withdrawals[0].amount,
            status: 'CREATING',
          }],
        }),
      };
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  const { createUsdtWithdrawalRequest } = require('../src/services/withdrawalService');
  const {
    handleNowPaymentsPayoutWebhook,
    triggerNowPaymentsPayoutForWithdrawal,
  } = require('../src/services/nowPaymentsPayoutService');
  const UsdtWithdrawal = require('../src/models/UsdtWithdrawal');

  let created;
  try {
    created = await createUsdtWithdrawalRequest(userId, {
      payout_method: 'crypto',
      network: 'TRC20',
      wallet_address: 'TJYeasTPa6gpEEfYq3p9ssL6UEseqbAAaf',
      amount_usdt: 25,
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(created.withdrawal?.id, 'withdrawal row required');
  assert.ok(created.payout?.payout_id === 'batch-payout-001', 'auto-payout must run');
  assert.strictEqual(created.withdrawal.status, 'processing');
  assert.strictEqual(created.withdrawal.nowpayments_payout_id, 'batch-payout-001');
  assert.strictEqual(created.withdrawal.payout_currency, 'usdttrc20');
  assert.strictEqual(created.withdrawal.payout_provider, 'nowpayments');

  const afterDebit = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.ok(Number(afterDebit.balance_usdt) < 100, 'gross amount must be debited');

  const authCall = calls.find((c) => c.url.endsWith('/auth'));
  const payoutCall = calls.find((c) => c.url.endsWith('/payout') && c.method === 'POST');
  assert.ok(authCall, 'must call /auth');
  assert.ok(payoutCall, 'must call /payout');
  console.log('ok');

  section('payout IPN finished marks completed');
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  const ipnBody = {
    id: 'batch-payout-001',
    batch_withdrawal_id: 'batch-payout-001',
    withdrawal_id: 'wd-item-001',
    status: 'FINISHED',
    hash: 'txid-abc123',
    unique_id: created.withdrawal.ref_code,
    currency: 'usdttrc20',
    amount: created.withdrawal.net_usdt,
  };
  const ipnSig = signIpn(ipnBody, secret);
  const ipnResult = await handleNowPaymentsPayoutWebhook({
    headers: { 'x-nowpayments-sig': ipnSig },
    body: ipnBody,
  });
  assert.strictEqual(ipnResult.finished, true);
  const done = await UsdtWithdrawal.findById(created.withdrawal.id);
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.tx_hash, 'txid-abc123');
  console.log('ok');

  section('failed payout IPN refunds balance');
  const phone2 = `09${String(Date.now() + 1).slice(-8)}`;
  const user2 = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 50)`,
    'Payout Fail',
    phone2
  );
  const userId2 = Number(user2.lastID);

  global.fetch = async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (String(url).endsWith('/auth')) {
      return { ok: true, json: async () => ({ token: 'jwt-2' }) };
    }
    if (String(url).endsWith('/payout') && method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          id: 'batch-fail-002',
          withdrawals: [{ id: 'wd-fail-002', status: 'WAITING', currency: 'usdttrc20', amount: 10 }],
        }),
      };
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  let created2;
  try {
    created2 = await createUsdtWithdrawalRequest(userId2, {
      network: 'TRC20',
      wallet_address: 'TJYeasTPa6gpEEfYq3p9ssL6UEseqbAAaf',
      amount_usdt: 20,
    });
  } finally {
    global.fetch = originalFetch;
  }

  const balBeforeFail = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId2);
  const failBody = {
    id: 'batch-fail-002',
    status: 'FAILED',
    unique_id: created2.withdrawal.ref_code,
  };
  const failSig = signIpn(failBody, secret);
  const failResult = await handleNowPaymentsPayoutWebhook({
    headers: { 'x-nowpayments-sig': failSig },
    body: failBody,
  });
  assert.strictEqual(failResult.failed, true);
  assert.strictEqual(failResult.refunded, true);
  const balAfterFail = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId2);
  assert.ok(
    Number(balAfterFail.balance_usdt) > Number(balBeforeFail.balance_usdt),
    'failed payout must refund'
  );
  const rejected = await UsdtWithdrawal.findById(created2.withdrawal.id);
  assert.strictEqual(rejected.status, 'rejected');
  console.log('ok');

  section('manual triggerNowPaymentsPayoutForWithdrawal payload');
  // Ensure helper still maps BEP20
  assert.strictEqual(payoutCurrencyForNetwork('BEP20'), 'usdtbsc');
  // Idempotent re-trigger on completed should refuse invalid status
  await assert.rejects(
    () => triggerNowPaymentsPayoutForWithdrawal(done, { force: true }),
    /status/i
  );
  console.log('ok');

  await closeDb().catch(() => {});
  try {
    fs.unlinkSync(dbFile);
  } catch {
    /* ignore */
  }

  console.log('\nNOWPayments payout checks passed.');
}

main().catch((err) => {
  console.error('\nNOWPayments payout checks FAILED:', err);
  process.exit(1);
});
