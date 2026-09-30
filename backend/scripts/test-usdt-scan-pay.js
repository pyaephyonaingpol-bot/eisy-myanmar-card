#!/usr/bin/env node
/**
 * Static checks: Scan Pay is disabled/hidden (UI + backend).
 * Parser unit tests remain for dormant service code.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const section = (t) => console.log(`\n== ${t} ==`);

function testUiDisabled() {
  section('UI wiring (Scan Pay disabled/hidden)');
  const index = read('public/index.html');
  const dash = read('public/dashboard.js');

  assert.ok(index.includes('id="btnOpenScanPay"'), 'home Scan Pay button id retained');
  assert.ok(
    /id="btnOpenScanPay"[^>]*(?:\bhidden\b|class="[^"]*\bhidden\b)/.test(index),
    'home Scan Pay button hidden'
  );
  assert.ok(
    /id="btnOpenScanPayPage"[^>]*(?:\bhidden\b|class="[^"]*\bhidden\b)/.test(index),
    'wallet page Scan Pay button hidden'
  );
  assert.ok(index.includes('data-feature="scan_pay"'), 'scan_pay feature marker');
  assert.ok(index.includes('data-feature-disabled="true"'), 'feature-disabled marker');

  assert.ok(dash.includes('openScanPayModal'), 'openScanPayModal kept');
  assert.ok(dash.includes('Scan Pay is disabled'), 'open/submit blocked with message');
  assert.ok(/async submitScanPay\(\)\s*\{[^}]*disabled/s.test(dash), 'submitScanPay disabled');
  console.log('ok');
}

function testBackendDisabled() {
  section('Backend wiring (Scan Pay gated)');
  const route = read('src/routes/usdtWallet.js');
  const flags = read('src/services/securityFlags.js');
  const service = read('src/services/scanPayService.js');

  assert.ok(route.includes("router.post('/scan-pay'"), 'POST scan-pay route');
  assert.ok(route.includes('isScanPayEnabled'), 'route checks SCAN_PAY_ENABLED');
  assert.ok(route.includes('scanPayDisabledPayload'), 'disabled payload');
  assert.ok(flags.includes("envFlag('SCAN_PAY_ENABLED', false)"), 'default OFF');
  assert.ok(service.includes('function executeScanPay'), 'service retained (dormant)');
  console.log('ok');
}

function testQrParser() {
  section('QR payload parser (dormant service)');
  const orig = Module.prototype.require;
  Module.prototype.require = function stub(id) {
    if (id === '../db') return { getDb: () => ({}) };
    if (id === './walletService') {
      return { debitUsdt: async () => ({}), formatUsdt: (n) => Number(n).toFixed(2) };
    }
    if (id === './usdtLedgerService') {
      return { getUsdtBalances: async () => ({ available_usdt: 10 }) };
    }
    if (id === './tronMasterWalletService') {
      return { isLikelyTronAddress: (a) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) };
    }
    if (id === './supabaseSyncService') return { syncUserWalletById: async () => {} };
    if (id === '../lib/supabase') return { getSupabase: () => null, isSupabaseEnabled: () => false };
    if (id === './supabaseWalletReadService') return { invalidateUserWalletCache: () => {} };
    if (id === '../../../lib/supabaseAdmin') {
      return { isSupabaseAdminEnabled: () => false, getSupabaseAdmin: () => null };
    }
    return orig.apply(this, arguments);
  };

  try {
    const abs = require.resolve('../src/services/scanPayService');
    delete require.cache[abs];
    const { parsePaymentQrPayload, validateDestination } = require('../src/services/scanPayService');

    const addr = 'TJYeasRUbRLg9y5G9cQhYrDgKMdPw9qJ1e';
    const json = parsePaymentQrPayload(JSON.stringify({ address: addr, amount: 12.5, network: 'TRC20' }));
    assert.strictEqual(json.destination_address, addr);
    assert.strictEqual(json.amount_usdt, 12.5);

    const tron = parsePaymentQrPayload(`tron:${addr}?amount=3.25`);
    assert.strictEqual(tron.destination_address, addr);
    assert.strictEqual(tron.amount_usdt, 3.25);

    const validated = validateDestination(addr, 'TRC20');
    assert.strictEqual(validated.network, 'TRC20');
    console.log('ok');
  } finally {
    Module.prototype.require = orig;
  }
}

testUiDisabled();
testBackendDisabled();
testQrParser();
console.log('\nScan Pay disabled checks passed.');
