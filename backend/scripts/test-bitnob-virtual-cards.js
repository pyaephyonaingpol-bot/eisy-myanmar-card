#!/usr/bin/env node
/**
 * Bitnob virtual-card client + USDT wallet orchestration tests (mocked HTTP).
 */
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function reloadBitnob() {
  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  return require(path.join(ROOT, 'lib/bitnob'));
}

function reloadBitnobService() {
  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/bitnobService'))];
  // walletService may be heavy — stub via require cache after mocking deps if needed
  return require(path.join(ROOT, 'backend/src/services/bitnobService'));
}

function setCreds() {
  process.env.BITNOB_CLIENT_ID = 'client-test-id';
  process.env.BITNOB_CLIENT_SECRET = 'client-test-secret';
  process.env.BITNOB_API_BASE_URL = 'https://api.bitnob.com';
  delete process.env.BITNOB_CARD_WEBHOOK_URL;
}

function testUnitsAndConfig() {
  section('units + config');
  setCreds();
  const bitnob = reloadBitnob();
  assert.strictEqual(bitnob.usdToMicrounits(5), 5_000_000);
  assert.strictEqual(bitnob.usdToMicrounits(0.5), 500_000);
  assert.strictEqual(bitnob.microunitsToUsd('2000000'), 2);
  assert.strictEqual(bitnob.microunitsToUsd(5_000_000), 5);

  const cfg = bitnob.getBitnobConfig();
  assert.strictEqual(cfg.clientId, 'client-test-id');
  assert.strictEqual(cfg.baseUrl, 'https://api.bitnob.com');
  console.log('ok');
}

function testHmacHeaders() {
  section('HMAC auth headers');
  setCreds();
  const bitnob = reloadBitnob();
  const body = { amount: 1000000, type: 'fund', reference: 'r1' };
  const bodyString = bitnob.canonicalizeBody(body);
  const headers = bitnob.buildAuthHeaders({
    clientId: 'client-test-id',
    clientSecret: 'client-test-secret',
    bodyString,
  });

  assert.ok(headers['X-Auth-Client']);
  assert.ok(headers['X-Auth-Timestamp']);
  assert.ok(headers['X-Auth-Nonce']);
  assert.ok(headers['X-Auth-Signature']);
  assert.strictEqual(headers['X-Auth-Nonce'].length, 32);

  const message = `client-test-id:${headers['X-Auth-Timestamp']}:${headers['X-Auth-Nonce']}:${bodyString}`;
  const expected = crypto
    .createHmac('sha256', 'client-test-secret')
    .update(message, 'utf8')
    .digest('hex');
  assert.strictEqual(headers['X-Auth-Signature'], expected);
  console.log('ok');
}

async function testCreateVirtualCard() {
  section('createVirtualCard');
  setCreds();
  const bitnob = reloadBitnob();
  const originalFetch = global.fetch;
  let captured = null;

  global.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          message: 'Card created',
          data: {
            card: {
              id: 'card-uuid-1',
              customer_id: 'cust-1',
              card_type: 'virtual',
              status: 'pending',
              created_status: 'processing',
              name: 'Aung Aung',
              masked_pan: '',
              balance_amount: '10000000',
              balance_currency: 'USD',
              display_amount: 10,
              reference: 'CARD_CREATE_ABC',
            },
          },
        });
      },
    };
  };

  try {
    const result = await bitnob.createVirtualCard({
      customerId: 'cust-1',
      name: 'Aung Aung',
      amountUsd: 10,
      reference: 'eisy-create-1',
    });

    assert.strictEqual(captured.url, 'https://api.bitnob.com/api/cards');
    assert.strictEqual(captured.opts.method, 'POST');
    assert.ok(captured.opts.headers['X-Auth-Signature']);

    const sent = JSON.parse(captured.opts.body);
    assert.strictEqual(sent.card_type, 'virtual');
    assert.strictEqual(sent.customer_id, 'cust-1');
    assert.strictEqual(sent.amount, 10_000_000);
    assert.strictEqual(sent.currency, 'USD');
    assert.strictEqual(sent.reference, 'eisy-create-1');

    assert.strictEqual(result.card.provider, 'bitnob');
    assert.strictEqual(result.card.card_id, 'card-uuid-1');
    assert.strictEqual(result.card.balance_usd, 10);
    assert.strictEqual(result.request.amount_microunits, 10_000_000);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testFundCard() {
  section('fundCard');
  setCreds();
  const bitnob = reloadBitnob();
  const originalFetch = global.fetch;
  let captured = null;

  global.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: {
            transaction: {
              id: 'tx-1',
              type: 'funding',
              status: 'pending',
              balance_before: '10000000',
              balance_after: '10000000',
            },
          },
        });
      },
    };
  };

  try {
    const result = await bitnob.fundCard({
      cardId: 'card-uuid-1',
      amountUsd: 25,
      reference: 'eisy-fund-1',
    });

    assert.strictEqual(
      captured.url,
      'https://api.bitnob.com/api/cards/card-uuid-1/balance'
    );
    const sent = JSON.parse(captured.opts.body);
    assert.strictEqual(sent.type, 'fund');
    assert.strictEqual(sent.amount, 25_000_000);
    assert.strictEqual(sent.reference, 'eisy-fund-1');
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(result.amount_usd, 25);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testGetCardDetails() {
  section('getCardDetails');
  setCreds();
  const bitnob = reloadBitnob();
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    assert.strictEqual(String(url), 'https://api.bitnob.com/api/cards/card-uuid-1');
    assert.strictEqual(opts.method, 'GET');
    assert.ok(!opts.body);
    // GET payload for HMAC is empty string
    const message = `client-test-id:${opts.headers['X-Auth-Timestamp']}:${opts.headers['X-Auth-Nonce']}:`;
    const expected = crypto
      .createHmac('sha256', 'client-test-secret')
      .update(message, 'utf8')
      .digest('hex');
    assert.strictEqual(opts.headers['X-Auth-Signature'], expected);

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: {
            card: {
              id: 'card-uuid-1',
              status: 'active',
              created_status: 'completed',
              name: 'Aung Aung',
              masked_pan: '**** **** **** 4532',
              balance_amount: '35000000',
              display_amount: 35,
              balance_currency: 'USD',
            },
          },
        });
      },
    };
  };

  try {
    const result = await bitnob.getCardDetails('card-uuid-1');
    assert.strictEqual(result.card.card_id, 'card-uuid-1');
    assert.strictEqual(result.card.status, 'active');
    assert.strictEqual(result.card.masked_pan, '**** **** **** 4532');
    assert.strictEqual(result.card.balance_usd, 35);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testUsdtOrchestrationWithMockWallet() {
  section('createVirtualCardFromUsdt / fundVirtualCardFromUsdt (mocked wallet)');
  setCreds();

  // Stub walletService before loading bitnobService
  const walletPath = path.join(ROOT, 'backend/src/services/walletService');
  const originalWallet = require.cache[require.resolve(walletPath)];
  const walletCalls = [];
  require.cache[require.resolve(walletPath)] = {
    id: walletPath,
    filename: walletPath,
    loaded: true,
    exports: {
      async debitUsdt(userId, amount, opts) {
        walletCalls.push({ op: 'debit', userId, amount, opts });
      },
      async creditUsdt(userId, amount, opts) {
        walletCalls.push({ op: 'credit', userId, amount, opts });
      },
      formatUsdt(n) {
        return Number(n).toFixed(2);
      },
    },
  };

  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/bitnobService'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  const service = require(path.join(ROOT, 'backend/src/services/bitnobService'));

  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.endsWith('/api/cards') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: {
              card: {
                id: 'card-from-usdt',
                customer_id: 'cust-9',
                status: 'pending',
                name: 'Maung Maung',
                balance_amount: '15000000',
                display_amount: 15,
                balance_currency: 'USD',
              },
            },
          });
        },
      };
    }
    if (u.includes('/balance')) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: { transaction: { id: 'tx-f', status: 'pending', type: 'funding' } },
          });
        },
      };
    }
    throw new Error(`unexpected fetch ${u}`);
  };

  try {
    const created = await service.createVirtualCardFromUsdt(42, {
      customerId: 'cust-9',
      name: 'Maung Maung',
      amountUsd: 15,
      issuanceFeeUsdt: 5,
      reference: 'REF_CREATE_USDT',
    });
    assert.strictEqual(created.card.card_id, 'card-from-usdt');
    assert.strictEqual(created.wallet.debited_usdt, 20);
    assert.strictEqual(created.wallet.load_usd, 15);
    assert.strictEqual(walletCalls[0].op, 'debit');
    assert.strictEqual(walletCalls[0].amount, 20);

    const funded = await service.fundVirtualCardFromUsdt(42, {
      cardId: 'card-from-usdt',
      amountUsd: 8,
      feeUsdt: 0,
      reference: 'REF_FUND_USDT',
    });
    assert.strictEqual(funded.funding.card_id, 'card-from-usdt');
    assert.strictEqual(funded.wallet.debited_usdt, 8);
    assert.strictEqual(funded.pending, true);
    assert.ok(walletCalls.some((c) => c.op === 'debit' && c.amount === 8));

    // Provider failure should refund
    walletCalls.length = 0;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      async text() {
        return JSON.stringify({ success: false, message: 'Insufficient Bitnob wallet' });
      },
    });

    let threw = false;
    try {
      await service.createVirtualCardFromUsdt(42, {
        customerId: 'cust-9',
        name: 'Maung Maung',
        amountUsd: 10,
        reference: 'REF_FAIL',
      });
    } catch (err) {
      threw = true;
      assert.ok(err.refunded);
      assert.strictEqual(err.code, 'BITNOB_HTTP_ERROR');
    }
    assert.ok(threw);
    assert.ok(walletCalls.some((c) => c.op === 'debit'));
    assert.ok(walletCalls.some((c) => c.op === 'credit' && c.amount === 10));
  } finally {
    global.fetch = originalFetch;
    if (originalWallet) {
      require.cache[require.resolve(walletPath)] = originalWallet;
    } else {
      delete require.cache[require.resolve(walletPath)];
    }
    delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/bitnobService'))];
    delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  }
  console.log('ok');
}

async function testMissingConfig() {
  section('missing config');
  delete process.env.BITNOB_CLIENT_ID;
  delete process.env.BITNOB_CLIENT_SECRET;
  delete process.env.BITNOB_SECRET_KEY;
  const bitnob = reloadBitnob();
  let code = null;
  try {
    await bitnob.getCardDetails('x');
  } catch (err) {
    code = err.code;
  }
  assert.strictEqual(code, 'BITNOB_NOT_CONFIGURED');
  console.log('ok');
}

async function main() {
  testUnitsAndConfig();
  testHmacHeaders();
  await testCreateVirtualCard();
  await testFundCard();
  await testGetCardDetails();
  await testUsdtOrchestrationWithMockWallet();
  await testMissingConfig();
  console.log('\nBitnob virtual-card checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
