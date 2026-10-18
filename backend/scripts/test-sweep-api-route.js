#!/usr/bin/env node
'use strict';

/**
 * Sweep API: routing, security, and Netts /order1h + USDT transfer (mocked).
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
const libPath = path.join(root, 'lib/nettsUsdtSweep.js');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function nettsOrder1hSuccess(extra = {}) {
  return {
    detail: {
      code: 10000,
      msg: 'Successful, 2.23 TRX deducted',
      data: {
        orderId: '1H123456',
        paidTRX: 2.23,
        hash: 'delegation-hash-mock',
        delegateAddress: 'TDelegateMock',
        energy: 65050,
        ...extra,
      },
    },
  };
}

function createMockTronWeb({
  balanceSun = '100000000',
  transferResult = 'mock-tx-hash-abc',
  transferThrows = null,
} = {}) {
  return {
    isAddress: () => true,
    setAddress: () => {},
    address: {
      fromPrivateKey: () => 'TChild1111111111111111111111111111',
    },
    contract: (_abi, _addr) => ({
      methods: {
        balanceOf: () => ({
          call: async () => balanceSun,
        }),
        transfer: (_to, _amount) => ({
          send: async (_opts) => {
            if (transferThrows) throw transferThrows;
            return transferResult;
          },
        }),
      },
    }),
  };
}

async function runMockedSweep(lib) {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      text: async () => JSON.stringify(nettsOrder1hSuccess()),
    };
  };

  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
    TRON_FULL_HOST: process.env.TRON_FULL_HOST,
    CENTRAL_WALLET_ADDRESS: process.env.CENTRAL_WALLET_ADDRESS,
    TRON_NETTS_REAL_IP: process.env.TRON_NETTS_REAL_IP,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.io/apiv2/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key-for-hmac';
  process.env.TRON_FULL_HOST = 'https://api.trongrid.io';
  process.env.CENTRAL_WALLET_ADDRESS = 'TCentral111111111111111111111111111';
  process.env.TRON_NETTS_REAL_IP = '203.0.113.50';

  try {
    const result = await lib.sweepUsdtWithNettsEnergy({
      childAddress: 'TChild1111111111111111111111111111',
      childPrivateKey: '0'.repeat(64),
      amountToSweep: '10',
      fetchImpl: mockFetch,
      tronWebFactory: () => createMockTronWeb(),
      sleepFn: async () => {},
      idempotencyNonce: 'fixed-nonce-for-test',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.txid, 'mock-tx-hash-abc');
    assert.strictEqual(result.amountInSun, '10000000');
    assert.strictEqual(result.nettsOrderId, '1H123456');
    assert.strictEqual(calls.length, 1);
    const headers = calls[0].init.headers;
    assert.ok(headers['X-API-KEY'] === 'test-key-for-hmac');
    assert.strictEqual(headers['X-Real-IP'], '203.0.113.50');
    assert.match(headers['X-Idempotency-Key'], /^[a-f0-9]{64}$/);
    const expectedKey = lib.makeIdempotencyKey(
      'test-key-for-hmac',
      'TChild1111111111111111111111111111',
      65000,
      'fixed-nonce-for-test',
    );
    assert.strictEqual(headers['X-Idempotency-Key'], expectedKey);
    const body = JSON.parse(calls[0].init.body);
    assert.strictEqual(body.amount, 65000);
    assert.strictEqual(body.receiveAddress, 'TChild1111111111111111111111111111');
    assert.strictEqual(body.address, undefined);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
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

  const fetch403 = async () => ({
    status: 403,
    text: async () => JSON.stringify({ code: 1004, msg: 'Insufficient funds. Required: 2.23 TRX, Available: 1.50 TRX' }),
  });

  try {
    await assert.rejects(
      () => lib.rentEnergyFromNetts('TChild1111111111111111111111111111', { fetchImpl: fetch403 }),
      (err) => err.code === 'SWEEP_NETTS_INSUFFICIENT_BALANCE',
    );
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function testNetts409Conflict(lib) {
  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.example/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';

  const fetch409 = async () => ({
    status: 409,
    text: async () =>
      JSON.stringify({
        success: false,
        error: 'duplicate_request_processing',
        message: 'This request is currently being processed.',
        retry_after_seconds: 5,
      }),
  });

  try {
    await assert.rejects(
      () => lib.rentEnergyFromNetts('TChild1111111111111111111111111111', { fetchImpl: fetch409 }),
      (err) => err.code === 'SWEEP_NETTS_CONFLICT' && err.retryAfterSeconds === 5,
    );
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function testAmountCap(lib) {
  const mockFetch = async () => ({
    status: 200,
    text: async () => JSON.stringify(nettsOrder1hSuccess()),
  });
  const prev = {
    TRON_ENERGY_API_URL: process.env.TRON_ENERGY_API_URL,
    TRON_ENERGY_API_KEY: process.env.TRON_ENERGY_API_KEY,
    TRON_FULL_HOST: process.env.TRON_FULL_HOST,
    CENTRAL_WALLET_ADDRESS: process.env.CENTRAL_WALLET_ADDRESS,
  };
  process.env.TRON_ENERGY_API_URL = 'https://netts.io/apiv2/order1h';
  process.env.TRON_ENERGY_API_KEY = 'test-key';
  process.env.TRON_FULL_HOST = 'https://api.trongrid.io';
  process.env.CENTRAL_WALLET_ADDRESS = 'TCentral111111111111111111111111111';

  try {
    const result = await lib.sweepUsdtWithNettsEnergy({
      childAddress: 'TChild1111111111111111111111111111',
      childPrivateKey: '0'.repeat(64),
      amountToSweep: '100',
      fetchImpl: mockFetch,
      tronWebFactory: () => createMockTronWeb({ balanceSun: '5000000' }),
      sleepFn: async () => {},
    });
    assert.strictEqual(result.amountCapped, true);
    assert.strictEqual(result.amountInSun, '5000000');
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
    text: async () => JSON.stringify(nettsOrder1hSuccess()),
  });

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
          tronWebFactory: () =>
            createMockTronWeb({ transferThrows: new Error('bandwidth exceeded') }),
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

async function main() {
  const routeSrc = fs.readFileSync(routePath, 'utf8');
  const sweepRouteSrc = fs.readFileSync(expressRoute, 'utf8');
  const indexSrc = fs.readFileSync(indexJs, 'utf8');
  const libSrc = fs.readFileSync(libPath, 'utf8');
  const vercel = JSON.parse(fs.readFileSync(vercelJson, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));

  section('Routing — production uses Express, not Next App Router');
  assert.strictEqual(pkg.dependencies?.next, undefined, 'Next.js is not installed');
  assert.ok(
    vercel.rewrites.some((r) => r.source === '/api/(.*)' && r.destination === '/api'),
    'Vercel rewrites /api/* to Express api/index.js',
  );
  assert.ok(indexSrc.includes("app.use('/api/sweep'"), 'Express mounts POST /api/sweep');

  section('Netts /order1h request shape in lib');
  assert.ok(libSrc.includes('receiveAddress'), 'uses receiveAddress');
  assert.ok(libSrc.includes('amount: energyAmount'), 'uses amount field');
  assert.ok(libSrc.includes('X-Real-IP'), 'supports TRON_NETTS_REAL_IP');
  assert.ok(libSrc.includes('X-Idempotency-Key'), 'idempotency header');
  assert.ok(libSrc.includes('detail.code === 10000'), 'strict Netts success parse');
  assert.ok(libSrc.includes('methods.transfer'), 'TronWeb methods.transfer like tronSweepService');

  section('Security — admin auth on live Express route');
  assert.ok(sweepRouteSrc.includes('requireAdminAuth'), 'sweep route uses requireAdminAuth');
  assert.ok(sweepRouteSrc.includes("requirePermission('master_wallet')"), 'sweep requires master_wallet');
  assert.ok(routeSrc.includes('isSweepAuthorized'), 'Next route checks admin key when used');
  assert.ok(
    sweepRouteSrc.includes('executeSingleDepositSweepFromRequest'),
    'Express sweep derives HD keys server-side',
  );
  assert.ok(
    !/childPrivateKey\s*,/.test(sweepRouteSrc),
    'Express route does not read childPrivateKey from body',
  );
  assert.ok(
    routeSrc.includes('executeSingleDepositSweepFromRequest'),
    'Next route uses server-side derivation helper',
  );
  assert.ok(
    routeSrc.includes('SWEEP_PRIVATE_KEY_NOT_ALLOWED') || routeSrc.includes('assertSweepPreflightOrThrow'),
    'Next route documents preflight / key rejection',
  );

  const sweepService = fs.readFileSync(
    path.join(root, 'backend/src/services/tronSweepService.js'),
    'utf8',
  );
  assert.ok(sweepService.includes('SWEEP_PRIVATE_KEY_NOT_ALLOWED'), 'service rejects client private keys');
  assert.ok(sweepService.includes('buildSweepPreflightReport'), 'preflight report helper exists');
  assert.ok(sweepService.includes('formatUsdtAmountFromSun'), 'exact USDT amount formatting');
  assert.ok(sweepService.includes('deriveDepositSigningMaterial'), 'centralized HD derive for sweep');

  section('Shared sweep library');
  const lib = require(libPath);
  assert.strictEqual(lib.parseAmountToSun('12.5'), '12500000');
  assert.strictEqual(lib.isNettsOrder1hSuccessful(200, nettsOrder1hSuccess()), true);
  assert.strictEqual(lib.isNettsOrder1hSuccessful(208, nettsOrder1hSuccess()), true);
  assert.strictEqual(lib.isNettsOrder1hSuccessful(200, { detail: { code: 5003 } }), false);

  section('Netts error classification');
  const insufficient = lib.classifyNettsFailure(403, { code: 1004, msg: 'Insufficient funds' }, '');
  assert.strictEqual(insufficient.code, 'SWEEP_NETTS_INSUFFICIENT_BALANCE');

  section('Netts timeout, balance, conflict (mocked)');
  await testNettsTimeout(lib);
  await testNettsInsufficientBalance(lib);
  await testNetts409Conflict(lib);

  section('USDT balance cap + chain failure (mocked)');
  await testAmountCap(lib);
  await testChainFailureAfterEnergy(lib);

  section('Full sweep flow (mocked fetch / TronWeb)');
  await runMockedSweep(lib);

  console.log('\nSweep API route checks — ok');
}

main().catch((err) => {
  console.error('\nSweep API route checks FAILED:', err.message || err);
  process.exit(1);
});
