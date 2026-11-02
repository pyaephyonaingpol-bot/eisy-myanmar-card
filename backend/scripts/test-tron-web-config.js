#!/usr/bin/env node
'use strict';

/**
 * TronWeb factory always sets TronGrid fullHost + TRON-PRO-API-KEY from env aliases.
 * Run: node backend/scripts/test-tron-web-config.js
 */
const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const keys = ['TRON_PRO_API_KEY', 'TRONGRID_API_KEY', 'TRON_API_KEY', 'TRON_FULL_HOST', 'TRONGRID_FULL_HOST'];

function snapshot() {
  const out = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function restore(snap) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const before = snapshot();
try {
  for (const k of keys) delete process.env[k];
  process.env.TRON_PRO_API_KEY = 'pro-key-for-tronweb';
  delete require.cache[require.resolve('../src/lib/envAliases')];
  delete require.cache[require.resolve('../src/lib/tronWeb')];

  let buildTronWebOptions = require('../src/lib/tronWeb').buildTronWebOptions;
  let opts = buildTronWebOptions({});
  assert.strictEqual(opts.fullHost, 'https://api.trongrid.io');
  assert.strictEqual(opts.headers['TRON-PRO-API-KEY'], 'pro-key-for-tronweb');

  for (const k of keys) delete process.env[k];
  process.env.TRONGRID_API_KEY = 'grid-key-only';
  delete require.cache[require.resolve('../src/lib/envAliases')];
  delete require.cache[require.resolve('../src/lib/tronWeb')];
  buildTronWebOptions = require('../src/lib/tronWeb').buildTronWebOptions;
  opts = buildTronWebOptions({ fullHost: 'https://api.trongrid.io/' });
  assert.strictEqual(opts.fullHost, 'https://api.trongrid.io');
  assert.strictEqual(opts.headers['TRON-PRO-API-KEY'], 'grid-key-only');

  process.env.TRON_FULL_HOST = 'https://custom.trongrid.example/';
  delete require.cache[require.resolve('../src/lib/envAliases')];
  delete require.cache[require.resolve('../src/lib/tronWeb')];
  buildTronWebOptions = require('../src/lib/tronWeb').buildTronWebOptions;
  opts = buildTronWebOptions({});
  assert.strictEqual(opts.fullHost, 'https://custom.trongrid.example');

  console.log('test-tron-web-config: OK');
} finally {
  restore(before);
}
