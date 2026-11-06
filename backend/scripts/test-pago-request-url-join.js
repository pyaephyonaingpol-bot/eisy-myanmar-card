#!/usr/bin/env node
'use strict';

/**
 * Ensures joinPagoRequestUrl dedupes /api/pago + /api/v1 without breaking path join.
 */
const assert = require('assert');
const { loadPagoCardClient } = require('../src/services/loadPagoCardClient');

const lib = loadPagoCardClient();
const join = lib.joinPagoRequestUrl || lib.default?.joinPagoRequestUrl;
if (typeof join !== 'function') {
  throw new Error('joinPagoRequestUrl must be exported from pagocard for tests');
}

assert.strictEqual(
  join('http://167.99.179.130/api/pago', '/api/v1/cards/x'),
  'http://167.99.179.130/api/pago/cards/x',
);

assert.strictEqual(
  join('http://167.99.179.130/api/pago/', '/api/v1/cards/x'),
  'http://167.99.179.130/api/pago/cards/x',
);

assert.strictEqual(
  join('https://pagocards.example/api/v1', '/api/v1/cards/x'),
  'https://pagocards.example/api/v1/api/v1/cards/x',
);

console.log('test-pago-request-url-join: OK');
