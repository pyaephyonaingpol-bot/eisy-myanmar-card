#!/usr/bin/env node
/**
 * NOWPayments IPN signature + local-deposit (no Supabase) smoke tests.
 * Run: node backend/scripts/test-nowpayments-ipn.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const SUPABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_PROJECT_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_KEY',
  'SUPABASE_PUBLIC_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SECRET_KEY',
];

function section(title) {
  console.log(`\n== ${title} ==`);
}

function signIpn(payload, secret) {
  const { sortObjectDeep } = require('../src/services/nowPaymentsService');
  return crypto.createHmac('sha512', secret)
    .update(JSON.stringify(sortObjectDeep(payload)))
    .digest('hex');
}

function snapshotEnv(keys) {
  const snap = {};
  for (const key of keys) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSupabaseEnv() {
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key) || SUPABASE_ENV_KEYS.includes(key)) {
      delete process.env[key];
    }
  }
}

async function main() {
  section('IPN signature verification');
  const secret = 'test-ipn-secret-key';
  process.env.NOWPAYMENTS_IPN_SECRET = secret;

  const payload = {
    payment_id: 123456789,
    payment_status: 'finished',
    pay_amount: 50,
    pay_currency: 'usdt',
    order_id: 'order-abc',
  };

  const {
    sortObjectDeep,
    verifyNowPaymentsSignature,
  } = require('../src/services/nowPaymentsService');

  const sorted = sortObjectDeep(payload);
  const sig = crypto.createHmac('sha512', secret)
    .update(JSON.stringify(sorted))
    .digest('hex');

  assert.ok(verifyNowPaymentsSignature(payload, sig), 'valid signature must pass');
  assert.ok(!verifyNowPaymentsSignature(payload, 'bad-signature'), 'invalid signature must fail');
  assert.ok(!verifyNowPaymentsSignature(payload, null), 'missing signature must fail');
  console.log('ok');

  section('process.env is read at call time');
  const {
    getNowPaymentsApiBase,
    getNowPaymentsApiKey,
  } = require('../src/services/nowPaymentsService');
  const { loadEnv, resetLoadEnvForTests } = require('../src/lib/loadEnv');

  const prevBase = process.env.NOWPAYMENTS_API_BASE_URL;
  const prevKey = process.env.NOWPAYMENTS_API_KEY;
  process.env.NOWPAYMENTS_API_BASE_URL = 'https://sandbox.nowpayments.io/v1/';
  process.env.NOWPAYMENTS_API_KEY = 'live-from-process-env';
  assert.strictEqual(getNowPaymentsApiBase(), 'https://sandbox.nowpayments.io/v1');
  assert.strictEqual(getNowPaymentsApiKey(), 'live-from-process-env');

  resetLoadEnvForTests();
  loadEnv({ force: true });
  assert.strictEqual(
    process.env.NOWPAYMENTS_API_KEY,
    'live-from-process-env',
    'loadEnv must not clobber non-empty process.env values'
  );

  if (prevBase === undefined) {
    delete process.env.NOWPAYMENTS_API_BASE_URL;
    assert.strictEqual(getNowPaymentsApiBase(), 'https://api.nowpayments.io/v1');
  } else {
    process.env.NOWPAYMENTS_API_BASE_URL = prevBase;
    assert.strictEqual(
      getNowPaymentsApiBase(),
      String(prevBase).trim().replace(/\/$/, '') || 'https://api.nowpayments.io/v1'
    );
  }
  if (prevKey === undefined) delete process.env.NOWPAYMENTS_API_KEY;
  else process.env.NOWPAYMENTS_API_KEY = prevKey;
  console.log('ok');

  section('Server-side Supabase enablement');
  const supabaseSnap = snapshotEnv(SUPABASE_ENV_KEYS);
  const {
    isSupabaseEnabled,
    isPublicSupabaseEnabled,
    resetSupabaseClientForTests,
  } = require('../src/lib/supabase');

  clearSupabaseEnv();
  resetSupabaseClientForTests();
  assert.strictEqual(isSupabaseEnabled(), false, 'missing credentials must disable supabase');
  assert.strictEqual(isPublicSupabaseEnabled(), false);

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';
  resetSupabaseClientForTests();
  assert.strictEqual(
    isSupabaseEnabled(),
    true,
    'URL + service role key must enable server-side supabase'
  );
  assert.strictEqual(
    isPublicSupabaseEnabled(),
    false,
    'browser config still requires a full anon key'
  );

  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'truncated-anon-key...';
  resetSupabaseClientForTests();
  assert.strictEqual(
    isSupabaseEnabled(),
    true,
    'truncated anon key must not disable a valid service role key'
  );

  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetSupabaseClientForTests();
  assert.strictEqual(
    isSupabaseEnabled(),
    false,
    'truncated anon key alone must disable supabase'
  );

  restoreEnv(supabaseSnap);
  resetSupabaseClientForTests();
  console.log('ok');

  section('pay_currency aliases map to NOWPayments tickers');
  const {
    normalizeNowPaymentsPayCurrency,
    pickNowPaymentsInvoicePayload,
    DEFAULT_PAY_CURRENCY,
  } = require('../src/services/nowPaymentsService');
  assert.strictEqual(DEFAULT_PAY_CURRENCY, 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency('usdt'), 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency('USDT'), 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency('usdttrc20'), 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency('usdt_trc20'), 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency('trx'), 'usdttrc20');
  assert.strictEqual(normalizeNowPaymentsPayCurrency(''), 'usdttrc20');
  const stripped = pickNowPaymentsInvoicePayload({
    price_amount: 25,
    price_currency: 'usd',
    pay_currency: 'usdttrc20',
    pay_amount: 25,
    usdt_network: 'TRC20',
    udst_network: 'TRC20',
    network: 'trx',
    order_id: 'NP1',
  });
  assert.strictEqual(stripped.pay_currency, 'usdttrc20');
  assert.strictEqual('usdt_network' in stripped, false, 'usdt_network must not be sent to NOWPayments');
  assert.strictEqual('udst_network' in stripped, false, 'udst_network must not be sent to NOWPayments');
  assert.strictEqual('network' in stripped, false, 'network must not be sent to NOWPayments');
  assert.strictEqual('pay_amount' in stripped, false, 'pay_amount is not an invoice field');
  assert.deepStrictEqual(Object.keys(stripped).sort(), ['order_id', 'pay_currency', 'price_amount', 'price_currency']);
  console.log('ok');

  section('NOWPayments checkout + IPN without Supabase');
  clearSupabaseEnv();
  resetSupabaseClientForTests();
  assert.strictEqual(isSupabaseEnabled(), false, 'this suite must run with supabase disabled');

  const dbFile = path.join(os.tmpdir(), `eisy-nowpayments-test-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.PUBLIC_BASE_URL = 'https://example.test';
  process.env.NOWPAYMENTS_API_KEY = 'test-nowpayments-api-key';
  process.env.NOWPAYMENTS_IPN_SECRET = secret;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();

  const db = getDb();
  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
    'NOWPayments Test',
    phone
  );
  const userId = Number(userIns.lastID);

  const originalFetch = global.fetch;
  let invoiceRequest;
  global.fetch = async (url, options) => {
    invoiceRequest = { url, options };
    return {
      ok: true,
      json: async () => ({
        id: 555001,
        invoice_url: 'https://nowpayments.io/payment/?iid=555001',
      }),
    };
  };

  const {
    createNowPaymentsPayment,
    handleNowPaymentsWebhook,
    findDepositByNowPaymentsIds,
  } = require('../src/services/nowPaymentsService');

  let created;
  try {
    created = await createNowPaymentsPayment(userId, {
      amount_usdt: 25,
      pay_currency: 'usdt',
      usdt_network: 'TRC20',
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(created.checkout_url, 'checkout_url is required');
  assert.strictEqual(created.payment_id, '555001');
  assert.ok(created.order_id, 'order_id is required');
  assert.ok(created.deposit?.id, 'local deposit row is required');
  assert.strictEqual(created.transaction, null, 'supabase transaction must be skipped when disabled');

  assert.ok(invoiceRequest, 'NOWPayments /invoice must be called');
  assert.ok(String(invoiceRequest.url).endsWith('/invoice'), 'must POST /v1/invoice');
  const sentBody = JSON.parse(invoiceRequest.options.body);
  assert.strictEqual(sentBody.pay_currency, 'usdttrc20', 'NOWPayments USDT on Tron ticker is usdttrc20');
  assert.strictEqual(sentBody.price_currency, 'usd');
  assert.strictEqual(sentBody.price_amount, 25);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(sentBody, 'usdt_network'),
    false,
    'usdt_network is not a NOWPayments invoice field'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(sentBody, 'udst_network'),
    false,
    'udst_network is not a NOWPayments invoice field'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(sentBody, 'network'),
    false,
    'network is not a NOWPayments invoice field'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(sentBody, 'pay_amount'),
    false,
    'invoice uses price_amount + price_currency usd, not pay_amount'
  );

  const pending = await findDepositByNowPaymentsIds({
    orderId: created.order_id,
    invoiceId: created.payment_id,
  });
  assert.ok(pending, 'local deposit must be findable by order/invoice id');
  assert.strictEqual(pending.status, 'PENDING');

  const ipnBody = {
    payment_id: 555001,
    invoice_id: 555001,
    payment_status: 'finished',
    pay_amount: 25,
    pay_currency: 'usdt',
    order_id: created.order_id,
    price_amount: 25,
  };
  const ipnSig = signIpn(ipnBody, secret);
  const webhookResult = await handleNowPaymentsWebhook({
    headers: { 'x-nowpayments-sig': ipnSig },
    body: ipnBody,
  });

  assert.strictEqual(webhookResult.finished, true, 'finished IPN must credit the local deposit');
  assert.strictEqual(webhookResult.alreadyVerified, false);

  const credited = await db.get('SELECT * FROM users WHERE id = ?', userId);
  assert.strictEqual(Number(credited.balance_usdt), 24, 'net credit is 25 - $1 minimum fee');

  const verified = await findDepositByNowPaymentsIds({ orderId: created.order_id });
  assert.strictEqual(verified.status, 'VERIFIED');

  const replay = await handleNowPaymentsWebhook({
    headers: { 'x-nowpayments-sig': ipnSig },
    body: ipnBody,
  });
  assert.ok(replay.alreadyFinished || replay.alreadyVerified, 'replay must not double-credit');
  const afterReplay = await db.get('SELECT * FROM users WHERE id = ?', userId);
  assert.strictEqual(Number(afterReplay.balance_usdt), 24, 'replay must keep the same balance');
  console.log('ok');

  await closeDb().catch(() => {});
  try {
    fs.unlinkSync(dbFile);
  } catch {
    /* ignore */
  }

  console.log('\nNOWPayments IPN + local deposit checks passed.');

  section('Supabase finish when IPN payment_id differs from invoice id');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-key';
  resetSupabaseClientForTests();

  const supabaseRows = [{
    id: 'tx-mismatch-1',
    user_id: '42',
    payment_id: '555001',
    amount: 24,
    currency: 'USDT',
    status: 'pending',
    payment_status: 'waiting',
    order_id: 'NP-ORDER-MISMATCH',
    metadata: { net_usdt: 24, deposit_ref: 'REF-MISMATCH' },
  }];

  function makeTransactionsMock(rows) {
    return {
      from(table) {
        if (table !== 'transactions') {
          throw new Error(`unexpected table: ${table}`);
        }
        const ctx = {};
        const chain = {
          select() { return chain; },
          insert(row) {
            rows.push(row);
            return {
              select() {
                return {
                  single: async () => ({ data: row, error: null }),
                };
              },
            };
          },
          update(payload) {
            ctx.update = payload;
            return chain;
          },
          eq(column, value) {
            ctx.filters = ctx.filters || [];
            ctx.filters.push({ column, value });
            return chain;
          },
          maybeSingle: async () => {
            const match = rows.find((row) => (
              (ctx.filters || []).every((f) => String(row[f.column]) === String(f.value))
            ));
            if (ctx.update && match) {
              Object.assign(match, ctx.update);
              return { data: { ...match }, error: null };
            }
            return { data: match ? { ...match } : null, error: null };
          },
        };
        return chain;
      },
    };
  }

  const supabase = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  const originalGetSupabase = supabase.getSupabase;
  supabase.getSupabase = () => makeTransactionsMock(supabaseRows);

  delete require.cache[require.resolve('../src/services/nowPaymentsService')];
  const {
    syncSupabaseTransactionAfterLocalDeposit,
  } = require('../src/services/nowPaymentsService');

  const ipnMismatchBody = {
    payment_id: 999888,
    invoice_id: 555001,
    order_id: 'NP-ORDER-MISMATCH',
    payment_status: 'finished',
    pay_amount: 25,
  };

  const finishedRow = await syncSupabaseTransactionAfterLocalDeposit(ipnMismatchBody, {
    paymentStatus: 'finished',
  });

  assert.ok(finishedRow, 'must resolve Supabase row via order_id/invoice_id and mark finished');
  assert.strictEqual(finishedRow.status, 'finished');
  assert.strictEqual(finishedRow.payment_id, '999888', 'payment_id must sync to IPN payment_id');
  assert.strictEqual(finishedRow.metadata.deposit_ref, 'REF-MISMATCH', 'metadata must be merged, not replaced');
  assert.deepStrictEqual(finishedRow.metadata.ipn, ipnMismatchBody);

  supabase.getSupabase = originalGetSupabase;
  delete require.cache[require.resolve('../src/services/nowPaymentsService')];
  resetSupabaseClientForTests();
  restoreEnv(supabaseSnap);
  console.log('ok');
}

main().catch((err) => {
  console.error('\nNOWPayments checks FAILED:', err);
  process.exit(1);
});
