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
  assert.ok(doc.includes('styles.css?v=20261009walletCopy'), 'CSS cache-bust bumped');
  assert.ok(doc.includes('dashboard.js?v=20261009walletCopy'), 'JS cache-bust bumped');
  assert.ok(doc.includes('i18n.js?v=20261009walletCopy'), 'i18n cache-bust bumped');
  assert.ok(doc.includes('id="pagoWalletCopyNumberBtn"'), 'card number copy button');
  assert.ok(doc.includes('id="pagoWalletCopyExpiryBtn"'), 'expiry copy button');
  assert.ok(doc.includes('id="pagoWalletCopyCvvBtn"'), 'CVV copy button');
  assert.ok(!doc.includes('id="pagoWalletModalNote"'), 'technical wallet note removed');
  assert.ok(!doc.includes('True 1-click push provisioning'), 'technical wallet note text removed');
}

assert.ok(css.includes('.pago-wallet-btn-apple'), 'Apple wallet button styles');
assert.ok(css.includes('.pago-wallet-btn-google'), 'Google Pay button styles');
assert.ok(css.includes('.pago-wallet-steps'), 'guided steps styles');
assert.ok(css.includes('.pago-wallet-fields'), 'per-field copy row styles');

assert.ok(dash.includes('openPagoWalletGuide'), 'wallet guide opener wired');
assert.ok(dash.includes('loadPagoWalletInfo'), 'wallet capability loader');
assert.ok(dash.includes("`/api/user/cards/${card.id}/wallet`") || dash.includes('/api/user/cards/${card.id}/wallet'), 'wallet API path used');
assert.ok(dash.includes('copyPagoWalletDetails'), 'copy details for wallet paste');
assert.ok(dash.includes('copyPagoWalletField'), 'per-field wallet copy');
assert.ok(dash.includes('formatWalletClipboard'), 'plain wallet clipboard payload');
assert.ok(!dash.includes('pagoWalletModalNote'), 'modal no longer fills the technical note');
assert.ok(dash.includes('fallbackPagoWalletInfo'), 'offline capability fallback');
assert.ok(dash.includes('pago_wallet_copy_failed'), 'clipboard failure softens to reveal+manual copy');

assert.ok(i18n.includes('pago_wallet_heading:'), 'EN wallet heading');
assert.ok(i18n.includes('pago_wallet_apple_title:'), 'EN Apple title');
assert.ok(i18n.includes('pago_wallet_google_title:'), 'EN Google title');
assert.ok(i18n.includes('pago_wallet_copy_failed:'), 'EN clipboard failure string');
assert.ok(i18n.includes('pago_wallet_copied_number:'), 'EN card number copied toast');
assert.ok(i18n.includes('pago_wallet_copied_expiry:'), 'EN expiry copied toast');
assert.ok(i18n.includes('pago_wallet_copied_cvv:'), 'EN CVV copied toast');
assert.ok(i18n.includes("pago_wallet_copied_number: 'ကဒ်နံပါတ် ကူးယူပြီးပါပြီ'"), 'MY card number copied toast');
assert.ok(i18n.includes("pago_wallet_heading: 'Apple Wallet နှင့် Google Pay ထည့်မည်'"), 'MY wallet heading');

assert.ok(service.includes('function getWalletProvisioningInfo'), 'capability helper exported');
assert.ok(service.includes('push_provisioning_available: false'), 'documents no push API');
assert.ok(service.includes('mode: \'manual_add\''), 'manual add mode');
assert.ok(service.includes('getWalletProvisioningInfo,'), 'helper in module.exports');

assert.ok(routes.includes("router.get('/cards/:id/wallet'"), 'wallet route registered');
assert.ok(routes.includes('getWalletProvisioningInfo'), 'route uses capability helper');

assert.ok(client.includes('token-provisioning'), 'client docs note missing provisioning API');

// Unit-ish check of the capability helper without spinning a DB.
const vm = require('vm');
const helperStart = dash.indexOf('  normalizeWalletExpiry(raw) {');
const helperEnd = dash.indexOf('  bindCardCopyButtons()');
assert.ok(helperStart > 0 && helperEnd > helperStart, 'wallet clipboard helpers are together');
const walletClipboard = vm.runInNewContext(`({ ${dash.slice(helperStart, helperEnd)} })`);
const spaced = walletClipboard.walletClipboardParts({
  card_number: '4111 1111 1111 1111',
  exp_date: '2028-12',
  cvv: '12 3',
});
assert.strictEqual(spaced.number, '4111111111111111');
assert.strictEqual(spaced.expiry, '12/28');
assert.strictEqual(spaced.cvv, '123');
assert.strictEqual(
  walletClipboard.formatWalletClipboard({
    card_number: '4111 1111 1111 1111',
    exp_date: '12/2028',
    cvv: '999',
  }),
  '4111111111111111\n12/28\n999'
);
assert.strictEqual(walletClipboard.normalizeWalletExpiry('1228'), '12/28');
assert.strictEqual(walletClipboard.normalizeWalletExpiry('202812'), '12/28');
assert.ok(!walletClipboard.formatWalletClipboard({
  card_number: '4242424242424242',
  exp_date: '01/30',
  cvv: '321',
}).includes('Card Number:'), 'copy-all payload has no field labels');

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
