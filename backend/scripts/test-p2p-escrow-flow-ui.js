#!/usr/bin/env node
/**
 * One-way P2P USDT escrow: shared flow helpers + portal markup wiring.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readPublic(name) {
  return fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
}

function testEscrowFlowModule() {
  console.log('\n== backend p2pEscrowFlow.js ==');
  const {
    p2pEscrowStepLabel,
    p2pEscrowStepIndex,
    normalizeP2pEscrowStatus,
    p2pEscrowStatusBadge,
  } = require('../src/services/p2pEscrowFlow');

  assert.strictEqual(p2pEscrowStepLabel('pending_payment'), 'Pending Payment');
  assert.strictEqual(p2pEscrowStepLabel('pending_seller_release'), 'Payment Sent');
  assert.strictEqual(p2pEscrowStepLabel('released'), 'USDT Released');
  assert.strictEqual(normalizeP2pEscrowStatus('pending_merchant_mmk'), 'pending_payment');
  assert.strictEqual(p2pEscrowStepIndex('pending_merchant_mmk'), 1);
  const buyerPending = p2pEscrowStatusBadge('pending_payment', { isMaker: false });
  assert.strictEqual(buyerPending.code, 'PENDING_PAYMENT');
  const sellerRelease = p2pEscrowStatusBadge('pending_seller_release', { isMaker: true, makerCanRelease: true });
  assert.strictEqual(sellerRelease.code, 'PAYMENT_SENT');
  assert.strictEqual(sellerRelease.requires_action, true);
  console.log('ok');
}

function testPortalHtml(file) {
  console.log(`\n== ${file}: escrow UI markup ==`);
  const html = readPublic(file);
  assert.ok(/p2pEscrowFlow\.js/.test(html), 'must load p2pEscrowFlow.js before dashboard');
  assert.ok(/id="p2pBuyEscrowStepper"/.test(html), 'buy modal escrow stepper host');
  assert.ok(/id="p2pSellEscrowStepper"/.test(html), 'sell modal escrow stepper host');
  assert.ok(/p2p-escrow-flow-banner/.test(html), 'P2P page one-way escrow banner');
  assert.ok(/Pending Payment/.test(html) && /Payment Sent/.test(html) && /USDT Released/.test(html));
  console.log('ok');
}

function testDashboardJs() {
  console.log('\n== dashboard.js: stepper sync ==');
  const js = readPublic('dashboard.js');
  assert.ok(/syncP2pEscrowStepperUi/.test(js), 'syncP2pEscrowStepperUi helper');
  assert.ok(/renderP2pSellWaitingStep[\s\S]*syncP2pEscrowStepperUi/.test(js), 'sell waiting step wires stepper');
  assert.ok(/renderP2pBuyPendingReleaseStep/.test(js), 'buy pending release step');
  assert.ok(/is-pending-payment/.test(js), 'active order badge classes');
  console.log('ok');
}

function testStyles() {
  console.log('\n== styles.css: escrow stepper ==');
  const css = readPublic('styles.css');
  assert.ok(/\.p2p-escrow-stepper/.test(css));
  assert.ok(/\.p2p-escrow-step\.is-current/.test(css));
  assert.ok(/\.is-payment-sent/.test(css));
  console.log('ok');
}

function main() {
  testEscrowFlowModule();
  testPortalHtml('index.html');
  testPortalHtml('instant.html');
  testDashboardJs();
  testStyles();
  console.log('\n[test-p2p-escrow-flow-ui] All checks passed.');
}

main();
