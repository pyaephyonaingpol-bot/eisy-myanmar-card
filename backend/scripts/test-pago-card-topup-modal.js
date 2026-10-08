#!/usr/bin/env node
'use strict';

/**
 * Card action Top Up button opens a modal and posts to the wallet-debit route.
 * Run: node backend/scripts/test-pago-card-topup-modal.js
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
const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'backend/src/services/pagoCardService.js'), 'utf8');

for (const doc of [html, instant]) {
  const actionsAt = doc.indexOf('class="pago-card-actions"');
  const appleAt = doc.indexOf('id="pagoAddAppleWalletBtn"');
  const googleAt = doc.indexOf('id="pagoAddGooglePayBtn"');
  const topupBtnAt = doc.indexOf('id="pagoCardTopupOpenBtn"');
  const actionsEnd = doc.indexOf('pagoWalletAtmHint');
  assert.ok(actionsAt > -1 && appleAt > actionsAt && googleAt > appleAt, 'wallet buttons stay in the action row');
  assert.ok(topupBtnAt > googleAt && topupBtnAt < actionsEnd, 'Top Up sits with the wallet actions');
  assert.ok(doc.includes('data-i18n="pago_topup_open"'), 'Top Up label is translated');
  assert.ok(doc.includes('id="pagoTopupModal"'), 'top-up modal present');
  assert.ok(doc.includes('id="pagoTopupAmount"'), 'amount field present');
  assert.ok(doc.includes('id="pagoTopupWallet"'), 'wallet balance preview present');
  assert.ok(doc.includes('id="pagoTopupToCard"'), 'card credit preview present');
  assert.ok(doc.includes('id="pagoTopupTotal"'), 'wallet debit preview present');
  assert.ok(doc.includes('id="pagoCardTopupSubmit"'), 'confirm button present');
  assert.ok(doc.includes('id="pagoTopupCancel"'), 'cancel button present');
  assert.ok(doc.includes('data-pago-topup-quick="20"'), 'quick amount chips present');
  const inlineHeading = doc.indexOf('id="pagoCardDetailPanel"');
  const formAt = doc.indexOf('id="pagoCardTopupForm"');
  assert.ok(formAt > -1 && formAt < inlineHeading, 'amount form lives in the modal, not under the card');
}

assert.ok(css.includes('.pago-action-topup'), 'Top Up button styles');
assert.ok(css.includes('.pago-topup-modal-box'), 'modal width');
assert.ok(css.includes('.pago-topup-quick'), 'quick amount styles');
assert.ok(css.includes('.pago-tx-columns'), 'transaction columns stay styled');
assert.ok(/\.pago-tx-columns\s*\{[^}]*display:\s*none/.test(css), 'transaction list stays a 2x2 grid');

assert.ok(dash.includes('openPagoTopupModal'), 'button opens the modal');
assert.ok(dash.includes('closePagoTopupModal'), 'cancel closes the modal');
assert.ok(dash.includes('updatePagoTopupPreview'), 'amount updates the preview');
assert.ok(dash.includes('`/api/user/cards/${cardId}/topup`'), 'confirm posts to the card top-up route');
assert.ok(dash.includes('amount_usdt: amount'), 'amount is sent to the API');
assert.ok(dash.includes("err.code === 'INSUFFICIENT_USDT_BALANCE'"), 'short wallet opens the wallet top-up');

assert.ok(i18n.includes("pago_topup_open: 'Top Up'"), 'EN button label');
assert.ok(i18n.includes("pago_topup_open: 'ငွေဖြည့်မည်'"), 'MY button label');
assert.ok(i18n.includes("pago_topup_heading: 'Top up this card'"), 'EN modal title');
assert.ok(i18n.includes("pago_topup_total: 'Deducted from wallet'"), 'EN debit label');
assert.ok(i18n.includes("pago_topup_to_card: 'ကဒ်ထဲ ပေါင်းထည့်မည့်ပမာဏ'"), 'MY card credit label');

assert.ok(routes.includes("router.post('/cards/:id/topup'"), 'top-up route registered');
assert.ok(routes.includes('topUpPagoCard'), 'route uses the wallet debit service');
assert.ok(service.includes('await debitUsdt(userId, pricing.deposit_usdt'), 'top-up debits the wallet');
assert.ok(service.includes('.topUpCard('), 'top-up funds the provider card');
assert.ok(service.includes('balanceDisplayUsd:'), 'local card balance is updated');
assert.ok(service.includes("await refundUsdt(userId, pricing.deposit_usdt, 'Refund Pago Card top-up')"), 'failed provider fund refunds the wallet');

console.log('pago card top-up modal checks passed');
