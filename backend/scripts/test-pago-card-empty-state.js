#!/usr/bin/env node
'use strict';

/**
 * My Cards empty state shows a sample plastic card placeholder.
 * Run: node backend/scripts/test-pago-card-empty-state.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');

for (const file of ['backend/public/index.html', 'backend/public/instant.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(html.includes('id="pagoCardEmpty"'), `${file}: empty state root`);
  assert.ok(html.includes('pago-plastic-sample'), `${file}: sample card shell`);
  assert.ok(html.includes('pago-sample-watermark'), `${file}: sample watermark`);
  assert.ok(html.includes('pago-card-request-panel'), `${file}: request panel follows card stage`);
  assert.ok(html.includes('styles.css?v=20261011pagoEmptyState'), `${file}: styles cache bust`);
}

assert.ok(css.includes('.pago-card-empty-state'), 'empty state layout styles');
assert.ok(css.includes('.pago-plastic-card.pago-plastic-sample'), 'sample card styles');
assert.ok(i18n.includes('pago_card_sample_watermark'), 'i18n watermark string');

console.log('Pago card empty state — ok');
