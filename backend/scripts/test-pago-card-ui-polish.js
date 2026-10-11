#!/usr/bin/env node
'use strict';

/**
 * Guards for modern Pago plastic-card UI + reveal toggle.
 * Run: node backend/scripts/test-pago-card-ui-polish.js
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

for (const doc of [html, instant]) {
  assert.ok(doc.includes('id="pagoPlasticCard"'), 'plastic card shell present');
  assert.ok(doc.includes('pago-plastic-reference'), 'reference layout class present');
  assert.ok(doc.includes('pago-plastic-emblem'), 'center emblem markup present');
  assert.ok(doc.includes('pago-plastic-details-row'), 'horizontal card details row present');
  assert.ok(!doc.includes('pago-plastic-rail'), 'vertical rail markup removed');
  assert.ok(doc.includes('pago-plastic-chip'), 'EMV chip markup present');
  assert.ok(doc.includes('id="pagoCardRevealBtn"'), 'reveal toggle button present');
  assert.ok(doc.includes('id="pagoCardCopyNumberBtn"'), 'copy number button present');
  assert.ok(doc.includes('id="pagoCardDetailBalance"'), 'balance chip present');
  assert.ok(doc.includes('pago-balance-chip') || doc.includes('pagoCardDetailBalance'), 'balance display wired');
  assert.ok(doc.includes('styles.css?v=20261011refCardHorizontal'), 'CSS cache-bust present');
  assert.ok(doc.includes('/brand/logo-card-mark.png?v=20261011refCard'), 'emblem uses card logo asset');
  assert.ok(doc.includes('dashboard.js?v='), 'JS cache-bust present');
  assert.ok(doc.includes('pago-plastic-foot-aside'), 'action icons sit in dedicated aside column');
  assert.ok(doc.includes('pago-plastic-eye'), 'eye toggle sits on the card face');
  assert.ok(doc.includes('pago-eye-open') && doc.includes('pago-eye-off'), 'eye open and closed icons');
  assert.ok(doc.includes('pago-plastic-copy'), 'copy control on card');
  assert.ok(doc.includes('id="pagoCardDetailNumber">•••• •••• •••• ••••'), 'card number starts masked');
  assert.ok(doc.includes('id="pagoCardDetailExpiry">••/••'), 'expiry starts masked');
  assert.ok(doc.includes('id="pagoCardDetailCvv"'), 'CVV element present on card face');
  assert.ok(doc.includes('id="pagoPlasticHolder"'), 'dynamic cardholder on details row');
  assert.ok(doc.includes('pago_card_product_line1'), 'product line i18n hook');
  assert.ok(doc.includes('id="pagoCardCarousel"'), 'card carousel present');
  assert.ok(doc.includes('id="pagoCardPrev"'), 'previous card control present');
  assert.ok(doc.includes('id="pagoCardNext"'), 'next card control present');
  assert.ok(doc.includes('id="pagoCardCopyNumberBtn"') && doc.includes('pago_copy_card'), 'Copy Card action present');
  assert.ok(doc.includes('class="pago-card-component'), 'single card component present');
  assert.ok((doc.match(/id="pagoPlasticCard"/g) || []).length === 1, 'one active plastic card shell');
  assert.ok(doc.includes('pago-plastic-sample'), 'sample card coexists with active shell');
}

assert.ok(css.includes('.pago-plastic-card'), 'plastic card styles exist');
assert.ok(css.includes('.pago-plastic-reference'), 'reference layout styles exist');
assert.ok(css.includes('.pago-plastic-emblem'), 'emblem styles exist');
assert.ok(!css.includes('rotate(-90deg)'), 'no rotated vertical card text');
assert.ok(!css.includes('writing-mode'), 'no vertical writing mode on card');
assert.ok(fs.existsSync(path.join(root, 'backend/public/brand/logo-card-mark.png')), 'transparent logo asset exists');
assert.ok(css.includes('.pago-plastic-eye'), 'eye button styles');
assert.ok(css.includes('.pago-plastic-copy') || css.includes('.pago-plastic-icon-btn'), 'copy button styles');
assert.ok(css.includes('.pago-plastic-chip'), 'chip styles exist');
assert.ok(css.includes('@keyframes pagoSheen'), 'sheen motion present');
assert.ok(css.includes('.pago-card-chip'), 'compact card switcher styles');
assert.ok(css.includes('.pago-card-slide'), 'carousel slide styles');
assert.ok(css.includes('.pago-card-carousel'), 'carousel layout styles');
assert.ok(css.includes('#pagoCardEmpty.hidden'), 'empty-state hint stays hidden when cards exist on mobile');
assert.ok(css.includes('.pago-card-actions'), 'action row styles');
assert.ok(/\.pago-card-actions[\s\S]{0,180}repeat\(2,\s*minmax\(0,\s*1fr\)/.test(css), 'actions use a uniform two-column grid');
assert.ok(css.includes('.pago-3ds-panel.pago-3ds-strip'), 'compact 3DS strip overrides exist');
assert.ok(/\.pago-3ds-panel\.pago-3ds-strip[\s\S]{0,600}min-height:\s*0/.test(css), '3DS strip avoids forced min-height');
assert.ok(/\.pago-3ds-panel\.pago-3ds-strip[\s\S]{0,800}display:\s*grid/.test(css), '3DS strip uses tight grid layout');
assert.ok(/\.pago-plastic-card[\s\S]{0,900}#2e1065/.test(css), 'pago card uses luxury purple metallic base');
assert.ok(css.includes('.pago-plastic-card::before'), 'brushed metallic texture overlay');
assert.ok(/\.pago-plastic-chip[\s\S]{0,260}#e2e8f0/.test(css), 'EMV chip uses silver metallic gradient');
assert.ok(css.includes('.pago-plastic-details-row'), 'horizontal details row styles');

assert.ok(dash.includes('togglePagoCardReveal'), 'reveal toggle wired');
assert.ok(dash.includes('pagoDetailRevealed'), 'reveal state tracked');
assert.ok(dash.includes('maskPagoNumber'), 'masked number helper');
assert.ok(dash.includes('pagoCardHolderName'), 'cardholder name helper');
assert.ok(dash.includes('pago-card-chip'), 'switcher renders compact chips');
assert.ok(dash.includes('selectPagoCard'), 'selecting a card is explicit');
assert.ok(dash.includes('stepPagoCard'), 'carousel steps between cards');
assert.ok(dash.includes('const many = cards.length > 1'), 'carousel appears when there is more than one card');
assert.ok(dash.includes('_pagoDetailRequestId'), 'a slower card response cannot overwrite the selected card');
assert.ok(dash.includes('/api/user/cards/${cardId}/transactions'), 'transactions are fetched for the selected card');
assert.ok(dash.includes('pagoCardBalanceText'), 'each slide and the detail show that card balance');
assert.ok(dash.includes('copyPagoCard'), 'copy card action wired');
assert.ok(dash.includes("pago_show_details"), 'show label used');
assert.ok(dash.includes("pago_hide_details"), 'hide label used');
const pagoDetailFn = dash.slice(dash.indexOf('showPagoCardDetail(card)'), dash.indexOf('cardTimeoutMessage'));
assert.ok(pagoDetailFn.includes("revealBtn.setAttribute('aria-label'"), 'eye label does not replace the icon');
assert.ok(!pagoDetailFn.includes('revealBtn.textContent'), 'pago eye control keeps its icon');
assert.ok(pagoDetailFn.includes('pagoPlasticHolder'), 'detail view updates cardholder');

assert.ok(i18n.includes('pago_show_details:'), 'EN show details string');
assert.ok(i18n.includes('pago_hide_details:'), 'EN hide details string');
assert.ok(i18n.includes("pago_show_details: 'နံပါတ်နှင့် CVV ပြမည်'"), 'MY show details string');
assert.ok(i18n.includes("pago_cards_heading_many: 'Your virtual cards'"), 'EN multi-card heading');
assert.ok(i18n.includes("pago_cards_heading_many: 'သင်၏ virtual ကတ်များ'"), 'MY multi-card heading');
assert.ok(i18n.includes('pago_card_product_line1:'), 'product line i18n');

console.log('pago card UI polish checks passed');
