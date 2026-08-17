#!/usr/bin/env node
/**
 * Smoke tests for Steps 3–5 modular frontend layers.
 * Run: node backend/scripts/test-frontend-modular-layers.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function loadScript(relPath, sandbox) {
  const code = fs.readFileSync(path.join(PUBLIC, relPath), 'utf8');
  vm.runInContext(code, sandbox, { filename: relPath });
}

function main() {
  const sandbox = {
    console,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ className: '', innerHTML: '', prepend() {} }),
    },
    Auth: {
      api: async (method, path) => ({ ok: true, method, path }),
      apiForm: async (path) => ({ ok: true, path }),
    },
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  // lib
  [
    'src/lib/config.js',
    'src/lib/storageKeys.js',
    'src/lib/constants.js',
    'src/lib/helpers.js',
    'src/lib/apiConfig.js',
    'src/lib/index.js',
  ].forEach((f) => loadScript(f, sandbox));

  // services
  [
    'src/services/apiClient.js',
    'src/services/depositApi.js',
    'src/services/usdtWalletApi.js',
    'src/services/withdrawalApi.js',
    'src/services/cardsApi.js',
    'src/services/accountApi.js',
    'src/services/p2pApi.js',
    'src/services/index.js',
  ].forEach((f) => loadScript(f, sandbox));

  // hooks
  [
    'src/hooks/submitBusy.js',
    'src/hooks/depositFees.js',
    'src/hooks/depositPolling.js',
    'src/hooks/index.js',
  ].forEach((f) => loadScript(f, sandbox));

  // components
  [
    'src/components/toast.js',
    'src/components/depositFeePreview.js',
    'src/components/usdtAddressBox.js',
    'src/components/activityLog.js',
    'src/components/index.js',
  ].forEach((f) => loadScript(f, sandbox));

  assert.ok(sandbox.EisyServices.ready);
  assert.ok(sandbox.EisyServices.deposit.createRequest);
  assert.ok(sandbox.EisyServices.usdtWallet.getOverview);
  assert.ok(sandbox.EisyServices.withdrawal.getFees);
  assert.ok(sandbox.EisyHooks.ready);
  assert.ok(sandbox.EisyHooks.depositFees.calculateUsdtDepositFeePreview(50, {}));
  assert.strictEqual(
    sandbox.EisyHooks.depositFees.calculateUsdtDepositFeePreview(50, {
      payment_service_fee_percent: 2,
      payment_service_fee_minimum_usdt: 1,
    }).fee_usdt,
    1
  );
  assert.ok(sandbox.EisyComponents.ready);
  assert.ok(sandbox.EisyComponents.toast.showToast);
  assert.ok(sandbox.EisyComponents.usdtAddressBox.showUsdtDepositAddress);

  const preview = sandbox.EisyHooks.depositFees.calculateUsdtDepositFeePreview(10, {
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 1,
  });
  assert.strictEqual(preview.fee_usdt, 1);
  assert.strictEqual(preview.net_usdt, 9);

  console.log('Frontend modular layers (steps 3–5) smoke checks passed.');
}

main();
