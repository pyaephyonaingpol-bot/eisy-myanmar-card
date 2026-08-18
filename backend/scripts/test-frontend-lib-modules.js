#!/usr/bin/env node
/**
 * Smoke test for Step 1–2 frontend lib modules (no browser required).
 * Run: node backend/scripts/test-frontend-lib-modules.js
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
    window: {},
    globalThis: null,
    module: { exports: {} },
    fetch: () => Promise.resolve(),
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  loadScript('src/lib/config.js', sandbox);
  loadScript('src/lib/storageKeys.js', sandbox);
  loadScript('src/lib/constants.js', sandbox);
  loadScript('src/lib/helpers.js', sandbox);
  loadScript('src/lib/apiConfig.js', sandbox);
  loadScript('src/lib/index.js', sandbox);
  loadScript('src/types/runtime.js', sandbox);
  loadScript('api-config.js', sandbox); // should no-op (already applied)

  assert.ok(sandbox.Eisy.config.PRODUCTION_API.includes('eisymyanmar'));
  assert.strictEqual(sandbox.Eisy.storageKeys.AUTH, 'eisy_auth');
  assert.strictEqual(sandbox.Eisy.storageKeys.ADMIN_TOKEN, 'eisy_admin_token');
  assert.strictEqual(sandbox.Eisy.constants.DEPOSIT_STATUS.VERIFIED, 'VERIFIED');
  assert.strictEqual(sandbox.EisyLib.storageKey('AUTH', 'x'), 'eisy_auth');
  assert.strictEqual(sandbox.Eisy.ready, true);
  assert.strictEqual(sandbox.Eisy.types.loaded, true);
  assert.ok(sandbox.__EISY_API_CONFIG_APPLIED__);

  console.log('Frontend lib module smoke checks passed.');
}

main();
