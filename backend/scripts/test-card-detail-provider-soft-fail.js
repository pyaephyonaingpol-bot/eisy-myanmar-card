#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const userRoutes = fs.readFileSync(path.join(root, 'src/routes/user.js'), 'utf8');
const {
  isCardProviderSoftError,
  isCardTimeoutError,
  isPagoRetrieveFailure,
} = require('../src/services/pagoCardService');

assert.ok(userRoutes.includes('isCardProviderSoftError'), 'detail route handles provider soft errors');
assert.ok(userRoutes.includes('provider_unavailable'), 'detail response flags provider_unavailable');
assert.ok(userRoutes.includes('panFromDbEarly'), 'detail route skips provider when pan URL is cached');
assert.ok(userRoutes.includes('?refresh'), 'detail route supports forced refresh');

assert.strictEqual(isCardProviderSoftError({ code: 'PAGO_NETWORK' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'PAGO_TIMEOUT' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'CARD_REQUEST_TIMEOUT' }), true);
assert.strictEqual(isCardProviderSoftError(new Error('fetch failed')), true);
assert.strictEqual(
  isCardProviderSoftError({ message: 'Unable to retrieve card.', code: 'PAGO_REQUEST_FAILED', status: 404 }),
  true
);
assert.strictEqual(isPagoRetrieveFailure({ message: 'Unable to retrieve card.' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'PAGO_PROXY_UNAUTHORIZED' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'VALIDATION_ERROR', status: 400 }), false);

const timeoutErr = { code: 'PAGO_TIMEOUT' };
assert.strictEqual(isCardTimeoutError(timeoutErr), true);

const dash = fs.readFileSync(path.join(root, 'public/dashboard.js'), 'utf8');
assert.ok(dash.includes('pago_retrieve_error') || dash.includes('PAGO_CARD_RETRIEVE_FAILED'));

console.log('test-card-detail-provider-soft-fail: OK');
