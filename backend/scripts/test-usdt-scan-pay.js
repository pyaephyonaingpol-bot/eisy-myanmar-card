#!/usr/bin/env node
/**
 * Static + unit checks for USDT Scan Pay dual-option QR UI and parser.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const section = (t) => console.log(`\n== ${t} ==`);

function testUiWiring() {
  section('UI wiring (dual options)');
  const index = read('public/index.html');
  const dash = read('public/dashboard.js');
  const css = read('public/styles.css');
  const i18n = read('public/i18n.js');

  assert.ok(index.includes('id="btnOpenScanPay"'), 'home Scan Pay button');
  assert.ok(index.includes('id="btnOpenScanPayPage"'), 'wallet page Scan Pay button');
  assert.ok(index.includes('id="scanPayModal"'), 'Scan Pay modal');
  assert.ok(index.includes('id="scanPayChooser"'), 'dual option chooser');
  assert.ok(index.includes('id="btnScanPayChooseCamera"'), 'camera option');
  assert.ok(index.includes('id="btnScanPayChooseUpload"'), 'upload option');
  assert.ok(index.includes('id="scanPayImageInput"'), 'image upload input');
  assert.ok(index.includes('id="scanPayVideo"'), 'camera video element');
  assert.ok(index.includes('id="scanPayCameraPanel"'), 'camera panel');
  assert.ok(index.includes('id="scanPayAmountInput"'), 'amount confirm input');
  assert.ok(/jsQR|jsqr/i.test(index), 'jsQR script for image decode');
  assert.ok(!/id="scanPayImageInput"[^>]*\scapture=/.test(index), 'upload must not force camera capture');

  assert.ok(dash.includes('openScanPayModal'), 'openScanPayModal');
  assert.ok(dash.includes('_scanPayShowChooser'), 'chooser mode helper');
  assert.ok(dash.includes('_scanPayShowCameraPanel'), 'camera panel helper');
  assert.ok(dash.includes('decodeScanPayImageFile'), 'image file decoder');
  assert.ok(dash.includes('jsQR'), 'dashboard uses jsQR');
  assert.ok(dash.includes("inversionAttempts: tryInvert ? 'attemptBoth'"), 'jsQR invert for images');
  assert.ok(dash.includes('Do not auto-start camera'), 'camera is opt-in');
  assert.ok(dash.includes('submitScanPay') || dash.includes('submitScanPay'), 'submit payment');

  assert.ok(css.includes('scan-pay-chooser'), 'chooser styles');
  assert.ok(css.includes('scan-pay-option'), 'option card styles');
  assert.ok(i18n.includes('scan_pay_option_camera_title'), 'i18n camera option');
  assert.ok(i18n.includes('scan_pay_option_upload_title'), 'i18n upload option');
  console.log('ok');
}

function testBackendWiring() {
  section('Backend wiring');
  const route = read('src/routes/usdtWallet.js');
  const service = read('src/services/scanPayService.js');
  const migration = read('migrations/060_usdt_scan_pay.sql');
  const sql = fs.readFileSync(path.resolve(ROOT, '..', 'supabase', 'wallet_scan_pay.sql'), 'utf8');

  assert.ok(route.includes("router.post('/scan-pay'"), 'POST scan-pay route');
  assert.ok(route.includes("router.post('/parse-qr'"), 'POST parse-qr route');
  assert.ok(route.includes('executeScanPay'), 'route calls executeScanPay');
  assert.ok(service.includes('function executeScanPay'), 'executeScanPay service');
  assert.ok(service.includes('function parsePaymentQrPayload'), 'QR parser');
  assert.ok(service.includes('debitUsdt'), 'Turso atomic debit');
  assert.ok(service.includes('debit_usdt_for_scan_pay'), 'Supabase RPC name');
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS usdt_scan_payments'), 'migration table');
  assert.ok(sql.includes('debit_usdt_for_scan_pay'), 'supabase RPC SQL');
  console.log('ok');
}

function testQrParser() {
  section('QR payload parser');
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

testUiWiring();
testBackendWiring();
testQrParser();
console.log('\nScan Pay dual-option checks passed.');
