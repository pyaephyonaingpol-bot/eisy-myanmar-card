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
  assert.ok(doc.includes('pago-plastic-chip'), 'EMV chip markup present');
  assert.ok(doc.includes('id="pagoCardRevealBtn"'), 'reveal toggle button present');
  assert.ok(doc.includes('id="pagoCardCopyNumberBtn"'), 'copy number button present');
  assert.ok(doc.includes('id="pagoCardDetailBalance"'), 'balance chip present');
  assert.ok(doc.includes('pago-balance-chip') || doc.includes('pagoCardDetailBalance'), 'balance display wired');
  assert.ok(doc.includes('styles.css?v=20261008pagoPlastic'), 'CSS cache-bust bumped');
  assert.ok(doc.includes('dashboard.js?v=20261008pagoPlastic'), 'JS cache-bust bumped');
}

assert.ok(css.includes('.pago-plastic-card'), 'plastic card styles exist');
assert.ok(css.includes('.pago-plastic-chip'), 'chip styles exist');
assert.ok(css.includes('@keyframes pagoSheen'), 'sheen motion present');
assert.ok(css.includes('.pago-card-tile'), 'list tiles are plastic cards');
assert.ok(!/purple-to-indigo|from-purple|to-indigo|#a855f7|#8b5cf6/i.test(css.match(/\.pago-plastic-card[\s\S]{0,500}/)?.[0] || ''), 'pago card avoids purple AI gradient cluster');

assert.ok(dash.includes('togglePagoCardReveal'), 'reveal toggle wired');
assert.ok(dash.includes('pagoDetailRevealed'), 'reveal state tracked');
assert.ok(dash.includes('maskPagoNumber'), 'masked number helper');
assert.ok(dash.includes('pago-card-tile'), 'list renders plastic tiles');
assert.ok(dash.includes("pago_show_details"), 'show label used');
assert.ok(dash.includes("pago_hide_details"), 'hide label used');

assert.ok(i18n.includes('pago_show_details:'), 'EN show details string');
assert.ok(i18n.includes('pago_hide_details:'), 'EN hide details string');
assert.ok(i18n.includes("pago_show_details: 'နံပါတ်နှင့် CVV ပြမည်'"), 'MY show details string');

console.log('pago card UI polish checks passed');
