#!/usr/bin/env node
/**
 * Wallet/reveal secret readiness + soft-error helpers for Pago cards.
 * Run: node backend/scripts/test-pago-wallet-secrets.js
 */
'use strict';

const assert = require('assert');
const {
  cardSecretsReady,
  isCardProviderSoftError,
  isCardTimeoutError,
} = require('../src/services/pagoCardService');

function ok(card) {
  assert.strictEqual(cardSecretsReady(card), true, JSON.stringify(card));
}

function no(card) {
  assert.strictEqual(cardSecretsReady(card), false, JSON.stringify(card));
}

ok({
  card_number: '4111111111111111',
  cvv: '123',
  exp_date: '08/30',
});

no({
  card_number: 'SECURE••••1111',
  cvv: '—',
  exp_date: '—',
});

no({
  card_number: 'SECURE••••1111',
  cvv: '123',
  exp_date: '08/30',
});

no({
  card_number: '4111111111111111',
  cvv: '',
  exp_date: '08/30',
});

no({
  card_number: '4111',
  cvv: '123',
  exp_date: '08/30',
});

no({
  card_number: 'PENDING-42',
  cvv: '123',
  exp_date: '08/30',
});

no(null);
no({});

assert.strictEqual(isCardTimeoutError({ code: 'PAGO_TIMEOUT' }), true);
assert.strictEqual(isCardTimeoutError({ code: 'CARD_REQUEST_TIMEOUT' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'PAGO_BAD_RESPONSE' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'PAGO_NETWORK' }), true);
assert.strictEqual(isCardProviderSoftError({ code: 'CARD_NOT_FOUND' }), false);

const fs = require('fs');
const path = require('path');
const dashboard = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
assert.ok(dashboard.includes('hasUsablePagoWalletSecrets'));
assert.ok(dashboard.includes('forcePanRefresh: true'));
assert.ok(dashboard.includes('pago_wallet_unblock_first'));
assert.ok(dashboard.includes('_pagoWalletBusy'));
assert.ok(dashboard.includes('queueSensitiveAction(() => this.openPagoWalletGuide(target))'));

console.log('pago wallet secrets checks: ok');
