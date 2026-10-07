#!/usr/bin/env node
/**
 * Pago Card client: request shape, validation, and error handling.
 * Uses a mocked fetch — no live provider calls.
 * Run: node --experimental-strip-types backend/scripts/test-pagocard-client.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const {
  PagoCardError,
  createPagoCardClient,
  truncateUsd,
} = require(path.join(__dirname, '../../lib/pagocard.ts'));

function clientWith(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls);
  };
  const api = createPagoCardClient({
    baseUrl: 'https://pagocards.example/api/v1/',
    apiKey: 'pub-test-key',
    secretKey: 'sec-test-key',
    fetchImpl,
  });
  return { api, calls };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

const sampleCard = {
  card_id: 'card_test_1',
  product_code: 'us_493_visa_bin_v2',
  brand: '493BIN',
  type: 'virtual',
  currency: 'USD',
  status: 'active',
  name_on_card: 'Ada Lovelace',
  email: 'ada@example.com',
  last_four: '4242',
  expiry_month: '08',
  expiry_year: '2030',
  balance: { amount: 10000000, display_amount: 10, currency: 'USD' },
  card_number: null,
  cvv: null,
  created_at: '2026-08-20T05:55:54+00:00',
};

(async () => {
  assert.strictEqual(truncateUsd(55.175678), 55.17);
  assert.strictEqual(truncateUsd(10), 10);

  {
    let called = false;
    const { api } = clientWith(async () => {
      called = true;
      return jsonResponse(201, { status: 'success', data: sampleCard });
    });
    const broken = createPagoCardClient({
      apiKey: '',
      secretKey: '',
      fetchImpl: async () => {
        called = true;
        throw new Error('should not fetch');
      },
    });
    await assert.rejects(
      () => broken.createCard({
        product_code: 'us_493_visa_bin_v2',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
      }),
      (err) => err instanceof PagoCardError && err.code === 'PAGO_NOT_CONFIGURED'
    );
    assert.strictEqual(called, false);
    void api;
  }

  {
    const { api, calls } = clientWith(async () => jsonResponse(201, {
      status: 'success',
      message: 'Card created successfully.',
      data: sampleCard,
    }));
    const card = await api.createVirtualCard({
      productCode: 'us_493_visa_bin_v2',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      initialLoad: 10.129,
      idempotencyKey: 'idem-1',
    });
    assert.strictEqual(card.card_id, 'card_test_1');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://pagocards.example/api/v1/cards');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.headers.publickey, 'pub-test-key');
    assert.strictEqual(calls[0].init.headers.secretkey, 'sec-test-key');
    assert.strictEqual(calls[0].init.headers['Idempotency-Key'], 'idem-1');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), {
      product_code: 'us_493_visa_bin_v2',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      initial_load: 10.12,
    });
  }

  {
    const { api, calls } = clientWith(async () => jsonResponse(201, {
      status: 'success',
      data: { ...sampleCard, product_code: 'us_493_visa_atm' },
    }));
    await api.createCard({
      product_code: 'us_493_visa_atm',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
    });
    assert.strictEqual(JSON.parse(calls[0].init.body).initial_load, undefined);
    await assert.rejects(
      () => api.createCard({
        product_code: 'us_493_visa_atm',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        initial_load: 10,
      }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  }

  {
    const { api } = clientWith(async () => jsonResponse(201, { status: 'success', data: sampleCard }));
    await assert.rejects(
      () => api.createCard({
        product_code: 'us_493_visa_bin_v2',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        initial_load: 9,
      }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  }

  {
    const { api, calls } = clientWith(async () => jsonResponse(200, {
      status: 'success',
      data: {
        ...sampleCard,
        balance: { amount: 12000000, display_amount: 12, currency: 'USD' },
        card_number: '4242424242424242',
        cvv: '123',
      },
    }));
    const details = await api.getCardDetails('card test/1');
    assert.strictEqual(details.last_four, '4242');
    assert.strictEqual(calls[0].url, 'https://pagocards.example/api/v1/cards/card%20test%2F1');
    assert.strictEqual(calls[0].init.method, 'GET');
    assert.strictEqual(calls[0].init.body, undefined);
    const balance = await api.getCardBalance('card_test_1');
    assert.deepStrictEqual(balance, { amount: 12000000, display_amount: 12, currency: 'USD' });
  }

  {
    const { api, calls } = clientWith(async () => jsonResponse(200, {
      status: 'success',
      message: 'Card funded successfully.',
      data: {
        card_id: 'card_test_1',
        amount: 10000000,
        display_amount: 10,
        currency: 'USD',
        status: 'completed',
        transaction_id: 'txn_1',
      },
    }));
    const funded = await api.topUpCard('card_test_1', 55.175678);
    assert.strictEqual(funded.transaction_id, 'txn_1');
    assert.strictEqual(calls[0].url, 'https://pagocards.example/api/v1/cards/card_test_1/fund');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { amount: 55.17 });
    calls.length = 0;
    await api.topUpCard({ cardId: 'card_test_1', amount: 10, idempotencyKey: 'fund-1' });
    assert.strictEqual(calls[0].init.headers['Idempotency-Key'], 'fund-1');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { amount: 10 });
    await assert.rejects(
      () => api.topUpCard({ cardId: 'card_test_1', amount: 4.99 }),
      (err) => err.code === 'VALIDATION_ERROR'
    );
  }

  {
    const { api } = clientWith(async () => jsonResponse(404, {
      status: 'failure',
      message: 'Card not found. secret sec-test-key',
      code: 'CARD_NOT_FOUND',
    }));
    await assert.rejects(
      () => api.getCardDetails('missing'),
      (err) => {
        assert.ok(err instanceof PagoCardError);
        assert.strictEqual(err.status, 404);
        assert.strictEqual(err.code, 'CARD_NOT_FOUND');
        assert.ok(!err.message.includes('sec-test-key'));
        assert.ok(err.message.includes('[redacted]'));
        return true;
      }
    );
  }

  {
    const { api } = clientWith(async () => {
      throw new Error('socket hang up pub-test-key');
    });
    await assert.rejects(
      () => api.getCardDetails('card_test_1'),
      (err) => err.code === 'PAGO_NETWORK' && !err.message.includes('pub-test-key')
    );
  }

  console.log('Pago Card client checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
