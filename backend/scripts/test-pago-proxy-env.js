#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { loadPagoCardClient } = require('../src/services/loadPagoCardClient');
const { evaluatePagoProxyEnvChecks } = require('../src/services/pagoProxyEnvCheck');

const { resolvePagoCardBaseUrl } = loadPagoCardClient();

const prev = {
  base: process.env.PAGO_CARD_API_BASE_URL,
  host: process.env.PAGO_CARD_PROXY_HOST,
  scheme: process.env.PAGO_CARD_PROXY_SCHEME,
  path: process.env.PAGO_CARD_PROXY_PATH,
  wl: process.env.PAGO_CARD_WHITELIST_IP,
};

function restore() {
  for (const [k, v] of Object.entries({
    PAGO_CARD_API_BASE_URL: prev.base,
    PAGO_CARD_PROXY_HOST: prev.host,
    PAGO_CARD_PROXY_SCHEME: prev.scheme,
    PAGO_CARD_PROXY_PATH: prev.path,
    PAGO_CARD_WHITELIST_IP: prev.wl,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

try {
  delete process.env.PAGO_CARD_API_BASE_URL;
  delete process.env.PAGO_CARD_PROXY_HOST;
  assert.strictEqual(resolvePagoCardBaseUrl(), '');

  process.env.PAGO_CARD_PROXY_HOST = '203.0.113.10';
  assert.strictEqual(
    resolvePagoCardBaseUrl(),
    'http://203.0.113.10/api/pago',
  );

  delete process.env.PAGO_CARD_PROXY_HOST;
  process.env.PAGO_CARD_API_BASE_URL = 'http://203.0.113.10/api/pago/';
  assert.strictEqual(resolvePagoCardBaseUrl(), 'http://203.0.113.10/api/pago');

  process.env.PAGO_CARD_WHITELIST_IP = '203.0.113.10';
  process.env.PAGO_CARD_API_KEY = 'test-key';
  process.env.PAGO_CARD_SECRET_KEY = 'test-secret';
  const checks = evaluatePagoProxyEnvChecks();
  assert.ok(checks.ok, checks.results.filter((r) => !r.ok).map((r) => r.id).join(','));

  const docs = fs.readFileSync(path.join(__dirname, '../docs/PAGO_PROXY_DROPLET.md'), 'utf8');
  assert.ok(docs.includes('PAGO_CARD_WHITELIST_IP'));
  assert.ok(docs.includes('verify-pago-proxy-env.js'));

  console.log('test-pago-proxy-env: OK');
} finally {
  restore();
}
