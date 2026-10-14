#!/usr/bin/env node
'use strict';

/**
 * Sweep API: routing, security, and Netts sweep logic (mocked — no live chain).
 * Run: node backend/scripts/test-sweep-api-route.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const routePath = path.join(root, 'app/api/sweep/route.ts');
const expressRoute = path.join(root, 'backend/src/routes/sweep.js');
const indexJs = path.join(root, 'backend/src/index.js');
const vercelJson = path.join(root, 'vercel.json');
const packageJson = path.join(root, 'package.json');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function runMockedSweep(lib) {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      text: async () => JSON.stringify({ success: true, orderId: 'mock-1' }),
    };
  };

  const mockTronWeb = {
    isAddress: (a) => a === 'TChild1111111111111111111111111111' || a === 'TCentral111111111111111111111111111',
    address: {
      fromPrivateKey: () => 'TChild1111111111111111111111111111',
    },
    contract: () => ({
      at: async () => ({
        transfer: (_to, _amount) => ({
          send: async () => 'mock-tx-hash-abc',
        }),
      }),
    }),
  };

  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
    TRON_FULL_HOST: process.env.TRON_FULL_HOST,
    CENTRAL_WALLET_ADDRESS: process.env.CENTRAL_WALLET_ADDRESS,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.example/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';
  process.env.TRON_FULL_HOST = 'https://api.trongrid.io';
  process.env.CENTRAL_WALLET_ADDRESS = 'TCentral111111111111111111111111111';

  try {
    const result = await lib.sweepUsdtWithNettsEnergy({
      childAddress: 'TChild1111111111111111111111111111',
      childPrivateKey: '0'.repeat(64),
      amountToSweep: '10',
      fetchImpl: mockFetch,
      tronWebFactory: () => mockTronWeb,
      sleepFn: async () => {},
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.txid, 'mock-tx-hash-abc');
    assert.strictEqual(result.amountInSun, '10000000');
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].init.headers['X-API-KEY'] === 'test-key');
    const body = JSON.parse(calls[0].init.body);
    assert.strictEqual(body.energy, 65000);
    assert.strictEqual(body.address, 'TChild1111111111111111111111111111');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main() {
  const routeSrc = fs.readFileSync(routePath, 'utf8');
  const sweepRouteSrc = fs.readFileSync(expressRoute, 'utf8');
  const indexSrc = fs.readFileSync(indexJs, 'utf8');
  const vercel = JSON.parse(fs.readFileSync(vercelJson, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));

  section('Routing — production uses Express, not Next App Router');
  assert.strictEqual(pkg.dependencies?.next, undefined, 'Next.js is not installed');
  assert.ok(
    vercel.rewrites.some((r) => r.source === '/api/(.*)' && r.destination === '/api'),
    'Vercel rewrites /api/* to Express api/index.js',
  );
  assert.ok(indexSrc.includes("app.use('/api/sweep'"), 'Express mounts POST /api/sweep');
  assert.ok(
    routeSrc.includes('backend/src/routes/sweep.js'),
    'Next route documents Express as live handler',
  );

  section('Security — admin auth on live Express route');
  assert.ok(sweepRouteSrc.includes('requireAdminAuth'), 'sweep route uses requireAdminAuth');
  assert.ok(sweepRouteSrc.includes("requirePermission('master_wallet')"), 'sweep requires master_wallet');
  assert.ok(routeSrc.includes('isSweepAuthorized'), 'Next route checks admin key when used');
  assert.ok(routeSrc.includes('ADMIN_REQUIRED'), 'Next route rejects unauthorized callers');

  section('Shared sweep library');
  const lib = require(path.join(root, 'lib/nettsUsdtSweep.js'));
  assert.strictEqual(lib.parseAmountToSun('12.5'), '12500000');
  assert.strictEqual(lib.isNettsEnergyOrderSuccessful(200, { success: true }), true);
  assert.strictEqual(lib.isNettsEnergyOrderSuccessful(200, { success: false }), false);

  section('Netts error classification');
  const insufficient = lib.classifyNettsFailure(402, { message: 'Insufficient balance' }, '');
  assert.strictEqual(insufficient.code, 'SWEEP_NETTS_INSUFFICIENT_BALANCE');
  const rateLimit = lib.classifyNettsFailure(429, {}, 'Too many requests');
  assert.strictEqual(rateLimit.code, 'SWEEP_NETTS_RATE_LIMIT');

  section('Netts timeout and balance errors (mocked)');
  await testNettsTimeout(lib);
  await testNettsInsufficientBalance(lib);
  await testChainFailureAfterEnergy(lib);

  section('Netts + transfer flow (mocked fetch / TronWeb)');
  await runMockedSweep(lib);

  console.log('\nSweep API route checks — ok');
}

async function testNettsTimeout(lib) {
  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.example/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';

  const slowFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });

  try {
    await assert.rejects(
      () =>
        lib.rentEnergyFromNetts('TChild1111111111111111111111111111', {
          fetchImpl: slowFetch,
          timeoutMs: 15,
        }),
      (err) => err.code === 'SWEEP_NETTS_TIMEOUT',
    );
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function testNettsInsufficientBalance(lib) {
  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.example/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';

  const fetch402 = async () => ({
    status: 402,
    text: async () => JSON.stringify({ success: false, message: 'Insufficient balance on Netts account' }),
  });

  try {
    await assert.rejects(
      () => lib.rentEnergyFromNetts('TChild1111111111111111111111111111', { fetchImpl: fetch402 }),
      (err) => err.code === 'SWEEP_NETTS_INSUFFICIENT_BALANCE',
    );
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function testChainFailureAfterEnergy(lib) {
  const mockFetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ success: true }),
  });
  const mockTronWeb = {
    isAddress: () => true,
    address: { fromPrivateKey: () => 'TChild1111111111111111111111111111' },
    contract: () => ({
      at: async () => ({
        transfer: () => ({
          send: async () => {
            throw new Error('bandwidth exceeded');
          },
        }),
      }),
    }),
  };

  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
    TRON_FULL_HOST: process.env.TRON_FULL_HOST,
    CENTRAL_WALLET_ADDRESS: process.env.CENTRAL_WALLET_ADDRESS,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.example/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';
  process.env.TRON_FULL_HOST = 'https://api.trongrid.io';
  process.env.CENTRAL_WALLET_ADDRESS = 'TCentral111111111111111111111111111';

  try {
    await assert.rejects(
      () =>
        lib.sweepUsdtWithNettsEnergy({
          childAddress: 'TChild1111111111111111111111111111',
          childPrivateKey: '0'.repeat(64),
          amountToSweep: '1',
          fetchImpl: mockFetch,
          tronWebFactory: () => mockTronWeb,
          sleepFn: async () => {},
        }),
      (err) => err.code === 'SWEEP_CHAIN_FAILED' && err.energyOrder != null,
    );
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

main().catch((err) => {
  console.error('\nSweep API route checks FAILED:', err.message || err);
  process.exit(1);
});
