#!/usr/bin/env node
'use strict';

/**
 * Guards for Add to Apple Wallet / Google Pay UI + capability endpoint.
 * Run: node backend/scripts/test-pago-wallet-buttons.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pagoCardService.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pagoAddAppleWalletBtn"'), 'Apple Wallet button present');
  assert.ok(doc.includes('id="pagoAddGooglePayBtn"'), 'Google Pay button present');
  assert.ok(doc.includes('id="pagoWalletModal"'), 'wallet guide modal present');
  assert.ok(doc.includes('id="pagoWalletCopyAllBtn"'), 'copy-all action in modal');
  assert.ok(doc.includes('id="pagoWalletAtmHint"'), 'ATM Google Pay hint present');
  assert.ok(doc.includes('styles.css?v=20261008cardTopup'), 'CSS cache-bust bumped');
  assert.ok(doc.includes('dashboard.js?v=20261008cardTopup'), 'JS cache-bust bumped');
  assert.ok(doc.includes('i18n.js?v=20261008cardTopup'), 'i18n cache-bust bumped');
}

assert.ok(css.includes('.pago-wallet-btn-apple'), 'Apple wallet button styles');
assert.ok(css.includes('.pago-wallet-btn-google'), 'Google Pay button styles');
assert.ok(css.includes('.pago-wallet-steps'), 'guided steps styles');

assert.ok(dash.includes('openPagoWalletGuide'), 'wallet guide opener wired');
assert.ok(dash.includes('loadPagoWalletInfo'), 'wallet capability loader');
assert.ok(dash.includes("`/api/user/cards/${card.id}/wallet`") || dash.includes('/api/user/cards/${card.id}/wallet'), 'wallet API path used');
assert.ok(dash.includes('copyPagoWalletDetails'), 'copy details for wallet paste');
assert.ok(dash.includes('fallbackPagoWalletInfo'), 'offline capability fallback');
assert.ok(dash.includes('pago_wallet_copy_failed'), 'clipboard failure softens to reveal+manual copy');

assert.ok(i18n.includes('pago_wallet_heading:'), 'EN wallet heading');
assert.ok(i18n.includes('pago_wallet_apple_title:'), 'EN Apple title');
assert.ok(i18n.includes('pago_wallet_google_title:'), 'EN Google title');
assert.ok(i18n.includes('pago_wallet_copy_failed:'), 'EN clipboard failure string');
assert.ok(i18n.includes("pago_wallet_heading: 'Apple Wallet နှင့် Google Pay ထည့်မည်'"), 'MY wallet heading');

assert.ok(service.includes('function getWalletProvisioningInfo'), 'capability helper exported');
assert.ok(service.includes('push_provisioning_available: false'), 'documents no push API');
assert.ok(service.includes('mode: \'manual_add\''), 'manual add mode');
assert.ok(service.includes('getWalletProvisioningInfo,'), 'helper in module.exports');

assert.ok(routes.includes("router.get('/cards/:id/wallet'"), 'wallet route registered');
assert.ok(routes.includes('getWalletProvisioningInfo'), 'route uses capability helper');

assert.ok(client.includes('token-provisioning'), 'client docs note missing provisioning API');

// Unit-ish check of the capability helper without spinning a DB.
const { getWalletProvisioningInfo } = require('../src/services/pagoCardService');
const visa = getWalletProvisioningInfo({ product_code: 'us_493_visa_bin_v2', brand: 'visa' });
assert.strictEqual(visa.push_provisioning_available, false);
assert.strictEqual(visa.mode, 'manual_add');
assert.strictEqual(visa.network_support.apple_pay, true);
assert.strictEqual(visa.network_support.google_pay, true);
assert.strictEqual(visa.contactless_google_pay, false);

const atm = getWalletProvisioningInfo({ product_code: 'us_493_visa_atm', brand: 'visa' });
assert.strictEqual(atm.contactless_google_pay, true);
assert.ok(atm.google_pay.contactless_hint);

console.log('pago wallet buttons checks passed');
