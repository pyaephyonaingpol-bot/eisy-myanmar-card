#!/usr/bin/env node
/**
 * Comprehensive Bitnob virtual-card integration tests (Step 3).
 *
 * Default: mocked HTTP — safe for CI (create / fund / details / USDT debit+refund).
 * Live mode (uses real Bitnob API keys from .env):
 *   BITNOB_LIVE_TEST=1 npm run test:bitnob-virtual-cards
 *   node backend/scripts/test-bitnob-virtual-cards.js --live
 *
 * Required for live create:
 *   BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET (or BITNOB_SECRET_KEY)
 *   BITNOB_DEFAULT_CUSTOMER_ID (or BITNOB_LIVE_CUSTOMER_ID) — KYC-approved customer
 *
 * Optional live knobs:
 *   BITNOB_LIVE_CARD_ID          — skip create; fund/details against this card
 *   BITNOB_LIVE_CREATE_AMOUNT    — USD load on create (default 5)
 *   BITNOB_LIVE_FUND_AMOUNT      — USD fund amount (default 2)
 *   BITNOB_LIVE_SKIP_CREATE=1    — whoami + details only (needs BITNOB_LIVE_CARD_ID)
 *   BITNOB_LIVE_SKIP_FUND=1      — do not call fund
 */
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..');

// Load .env without clobbering shell overrides (for live mode).
require(path.join(ROOT, 'backend/src/lib/loadEnv'));

const LIVE = process.argv.includes('--live')
  || String(process.env.BITNOB_LIVE_TEST || '').trim() === '1';

function section(title) {
  console.log(`\n== ${title} ==`);
}

const MOCK_CLIENT_ID = 'client-test-id';
const MOCK_CLIENT_SECRET = 'client-test-secret';

/** Snapshot of Bitnob-related env before mock suite mutates process.env. */
const SAVED_BITNOB_ENV = {
  BITNOB_CLIENT_ID: process.env.BITNOB_CLIENT_ID,
  BITNOB_CLIENT_SECRET: process.env.BITNOB_CLIENT_SECRET,
  BITNOB_SECRET_KEY: process.env.BITNOB_SECRET_KEY,
  BITNOB_API_BASE_URL: process.env.BITNOB_API_BASE_URL,
  BITNOB_CARD_WEBHOOK_URL: process.env.BITNOB_CARD_WEBHOOK_URL,
};

function reloadBitnob() {
  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  return require(path.join(ROOT, 'lib/bitnob'));
}

function setMockCreds() {
  process.env.BITNOB_CLIENT_ID = MOCK_CLIENT_ID;
  process.env.BITNOB_CLIENT_SECRET = MOCK_CLIENT_SECRET;
  process.env.BITNOB_API_BASE_URL = 'https://api.bitnob.com';
  delete process.env.BITNOB_CARD_WEBHOOK_URL;
  delete process.env.BITNOB_SECRET_KEY;
}

function restoreBitnobEnv() {
  for (const [key, value] of Object.entries(SAVED_BITNOB_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[require.resolve(path.join(ROOT, 'lib/bitnob'))];
  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/bitnobService'))];
}

function hasLiveCreds() {
  const id = String(process.env.BITNOB_CLIENT_ID || '').trim();
  const secret = String(
    process.env.BITNOB_CLIENT_SECRET || process.env.BITNOB_SECRET_KEY || ''
  ).trim();
  if (!id || !secret || secret.includes('...')) return false;
  // Never treat mock-suite placeholders as real API keys.
  if (id === MOCK_CLIENT_ID || secret === MOCK_CLIENT_SECRET) return false;
  return true;
}

function liveCustomerId() {
  return String(
    process.env.BITNOB_LIVE_CUSTOMER_ID
    || process.env.BITNOB_DEFAULT_CUSTOMER_ID
    || ''
  ).trim();
}

/* ───────────────────────── Mocked suite ───────────────────────── */

function testUnitsAndConfig() {
  section('units + config (mock)');
  setMockCreds();
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
  section('HMAC auth headers (mock)');
  setMockCreds();
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

function testBitnobFeeSchedule() {
  section('Bitnob fee schedule ($2 create + funding tiers)');
  const {
    BITNOB_CARD_CREATE_FEE_USD,
    resolveBitnobFundingFeeUsd,
    getBitnobFeeSchedule,
  } = require(path.join(ROOT, 'backend/src/constants/bitnobFees'));

  assert.strictEqual(BITNOB_CARD_CREATE_FEE_USD, 2);
  assert.strictEqual(resolveBitnobFundingFeeUsd(50), 1);
  assert.strictEqual(resolveBitnobFundingFeeUsd(100), 1);
  assert.strictEqual(resolveBitnobFundingFeeUsd(250), 2.5);
  const schedule = getBitnobFeeSchedule();
  assert.strictEqual(schedule.create_fee_usd, 2);
  assert.ok(schedule.fund_fee_rule);
  console.log('ok');
}

function testUsdtPricingIncludesBitnobFees() {
  section('USDT pricing includes Bitnob create/funding fees');
  const {
    calculateCardRequestPricingUsdt,
    calculateCardReloadPricingUsdt,
  } = require(path.join(ROOT, 'backend/src/services/settingsService'));

  const issue = calculateCardRequestPricingUsdt(25, {
    card_issuance_fee_usd: 5,
    minimum_initial_deposit_usd: 10,
  });
  assert.strictEqual(issue.bitnob_create_fee_usd, 2);
  assert.strictEqual(issue.bitnob_funding_fee_usd, 1);
  assert.strictEqual(issue.payment_wallet, 'usdt');
  assert.strictEqual(issue.mmk_wallet_allowed, false);
  assert.strictEqual(issue.total_charge_usdt, 34.5);

  const reload = calculateCardReloadPricingUsdt(40, {
    minimum_usdt_reload: 5,
    card_reload_fee_usd: 2,
  });
  assert.strictEqual(reload.bitnob_funding_fee_usd, 1);
  assert.strictEqual(reload.deposit_usdt, 43);
  assert.strictEqual(reload.mmk_wallet_allowed, false);
  console.log('ok');
}

async function testCreateVirtualCard() {
  section('createVirtualCard (mock HTTP)');
  setMockCreds();
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
  section('fundCard (mock HTTP)');
  setMockCreds();
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
  section('getCardDetails (mock HTTP)');
  setMockCreds();
  const bitnob = reloadBitnob();
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    assert.strictEqual(String(url), 'https://api.bitnob.com/api/cards/card-uuid-1');
    assert.strictEqual(opts.method, 'GET');
    assert.ok(!opts.body);
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

async function testGetSecureCardDetails() {
  section('getSecureCardDetails (mock HTTP)');
  setMockCreds();
  const bitnob = reloadBitnob();
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    assert.strictEqual(String(url), 'https://api.bitnob.com/api/cards/card-uuid-1/secure');
    assert.strictEqual(opts.method, 'GET');
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: {
            encrypted_details: { ciphertext: 'abc', encrypted_key: 'xyz' },
            balance_amount: '35000000',
          },
        });
      },
    };
  };

  try {
    const result = await bitnob.getSecureCardDetails('card-uuid-1');
    assert.strictEqual(result.card_id, 'card-uuid-1');
    assert.ok(result.encrypted_details);
    assert.strictEqual(result.balance_usd, 35);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ok');
}

async function testUsdtOrchestrationWithMockWallet() {
  section('createVirtualCardFromUsdt / fundVirtualCardFromUsdt (mocked wallet)');
  setMockCreds();

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
  const prevId = process.env.BITNOB_CLIENT_ID;
  const prevSecret = process.env.BITNOB_CLIENT_SECRET;
  const prevAlias = process.env.BITNOB_SECRET_KEY;
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
  if (prevId !== undefined) process.env.BITNOB_CLIENT_ID = prevId;
  if (prevSecret !== undefined) process.env.BITNOB_CLIENT_SECRET = prevSecret;
  if (prevAlias !== undefined) process.env.BITNOB_SECRET_KEY = prevAlias;
  console.log('ok');
}

async function runMockSuite() {
  console.log('\n──── Mocked suite ────');
  testUnitsAndConfig();
  testHmacHeaders();
  testBitnobFeeSchedule();
  testUsdtPricingIncludesBitnobFees();
  await testCreateVirtualCard();
  await testFundCard();
  await testGetCardDetails();
  await testGetSecureCardDetails();
  await testUsdtOrchestrationWithMockWallet();
  await testMissingConfig();
  restoreBitnobEnv();
  console.log('\nMocked Bitnob virtual-card checks passed.');
}

/* ───────────────────────── Live suite ───────────────────────── */

async function runLiveSuite() {
  console.log('\n──── Live Bitnob API suite ────');
  // Drop any mock-suite env leftovers before reading credentials.
  restoreBitnobEnv();
  if (!hasLiveCreds()) {
    console.log('SKIP live — set BITNOB_CLIENT_ID and BITNOB_CLIENT_SECRET (or BITNOB_SECRET_KEY)');
    return { skipped: true, reason: 'missing_credentials' };
  }

  const bitnob = require(path.join(ROOT, 'lib/bitnob'));
  const cfg = bitnob.getBitnobConfig();
  console.log(`Using base URL ${cfg.baseUrl} (client ${cfg.clientId.slice(0, 6)}…)`);

  const summary = {
    whoami: null,
    created_card_id: null,
    details_before_fund: null,
    fund: null,
    details_after_fund: null,
  };

  section('live validateAuth (GET /api/whoami)');
  try {
    const who = await bitnob.validateAuth();
    summary.whoami = {
      ok: true,
      keys: who.data && typeof who.data === 'object' ? Object.keys(who.data).slice(0, 12) : [],
    };
    console.log('ok — credentials accepted');
  } catch (err) {
    console.error('FAIL whoami:', err.code || '', err.message);
    throw err;
  }

  const skipCreate = String(process.env.BITNOB_LIVE_SKIP_CREATE || '').trim() === '1';
  let cardId = String(process.env.BITNOB_LIVE_CARD_ID || '').trim();

  if (!skipCreate && !cardId) {
    const customerId = liveCustomerId();
    if (!customerId) {
      console.log(
        'SKIP create — set BITNOB_DEFAULT_CUSTOMER_ID or BITNOB_LIVE_CUSTOMER_ID '
        + '(KYC-approved Bitnob customer). You can still set BITNOB_LIVE_CARD_ID to test fund/details.'
      );
    } else {
      section('live createVirtualCard (POST /api/cards)');
      const amountUsd = Number(process.env.BITNOB_LIVE_CREATE_AMOUNT) || 5;
      const reference = `EISY_LIVE_CREATE_${Date.now()}`;
      const created = await bitnob.createVirtualCard({
        customerId,
        name: process.env.BITNOB_LIVE_CARDHOLDER_NAME || 'Eisy Live Test',
        amountUsd,
        reference,
        webhookUrl: process.env.BITNOB_CARD_WEBHOOK_URL || undefined,
      });
      assert.ok(created.card?.card_id, 'create must return card_id');
      cardId = created.card.card_id;
      summary.created_card_id = cardId;
      console.log(`ok — created card ${cardId} (status=${created.card.status}, created_status=${created.card.created_status})`);
    }
  } else if (cardId) {
    console.log(`Using existing BITNOB_LIVE_CARD_ID=${cardId}`);
    summary.created_card_id = cardId;
  }

  if (!cardId) {
    console.log('SKIP fund/details — no card id available');
    return summary;
  }

  section('live getCardDetails (GET /api/cards/:id)');
  {
    const details = await bitnob.getCardDetails(cardId);
    assert.strictEqual(details.card.card_id, cardId);
    summary.details_before_fund = {
      status: details.card.status,
      created_status: details.card.created_status,
      masked_pan: details.card.masked_pan,
      balance_usd: details.card.balance_usd,
    };
    console.log(
      `ok — status=${details.card.status} balance_usd=${details.card.balance_usd} `
      + `masked=${details.card.masked_pan || '(empty)'}`
    );
  }

  const skipFund = String(process.env.BITNOB_LIVE_SKIP_FUND || '').trim() === '1';
  if (!skipFund) {
    section('live fundCard (POST /api/cards/:id/balance)');
    const fundUsd = Number(process.env.BITNOB_LIVE_FUND_AMOUNT) || 2;
    const reference = `EISY_LIVE_FUND_${Date.now()}`;
    const funded = await bitnob.fundCard({
      cardId,
      amountUsd: fundUsd,
      reference,
    });
    assert.strictEqual(funded.card_id, cardId);
    summary.fund = {
      status: funded.status,
      amount_usd: funded.amount_usd,
      reference: funded.reference,
      transaction_id: funded.transaction?.id || null,
    };
    console.log(`ok — fund accepted status=${funded.status} amount=${funded.amount_usd} ref=${funded.reference}`);
    console.log('(funding is async — poll getCardDetails or wait for webhook for final balance)');

    section('live getCardDetails after fund');
    const after = await bitnob.getCardDetails(cardId);
    summary.details_after_fund = {
      status: after.card.status,
      balance_usd: after.card.balance_usd,
      masked_pan: after.card.masked_pan,
    };
    console.log(`ok — balance_usd=${after.card.balance_usd} status=${after.card.status}`);
  } else {
    console.log('SKIP fund — BITNOB_LIVE_SKIP_FUND=1');
  }

  console.log('\nLive Bitnob virtual-card checks finished.');
  console.log('Summary:', JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  await runMockSuite();

  if (LIVE) {
    await runLiveSuite();
  } else {
    console.log(
      '\n(Tip) Re-run with BITNOB_LIVE_TEST=1 or --live to exercise real Bitnob API keys.'
    );
  }

  console.log('\nBitnob virtual-card integration checks passed.');
}

main().catch((err) => {
  console.error('\nBitnob virtual-card tests FAILED');
  console.error(err.code || '', err.message);
  if (err.payload) {
    try {
      console.error('payload:', JSON.stringify(err.payload).slice(0, 800));
    } catch (_) { /* ignore */ }
  }
  process.exit(1);
});
