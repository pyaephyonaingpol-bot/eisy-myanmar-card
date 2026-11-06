#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const userRoutes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
const pagocard = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');

assert.ok(pagocard.includes('card_pan_url'), 'PagoCard type includes card_pan_url');
assert.ok(userRoutes.includes('card_pan_url'), 'API maps card_pan_url');
assert.ok(userRoutes.includes('pan_view'), 'API exposes pan_view mode');
assert.ok(html.includes('id="pagoCardPanFrame"'), 'secure iframe in cards UI');
assert.ok(html.includes('pagoCardLegacyPanFields'), 'legacy PAN fields separated');
assert.ok(dash.includes('usesPagoPanIframe'), 'dashboard detects iframe cards');
assert.ok(dash.includes('renderPagoPanIframe'), 'dashboard renders iframe');
assert.ok(dash.includes('pagoCardPanFrame'), 'dashboard references iframe element');

const { usesPagoPanIframe, readCardPanUrlFromSources } = require('../src/services/pagoPanView');
assert.strictEqual(
  usesPagoPanIframe({ provider: 'pago', product_code: 'us_493_visa_bin_v2' }),
  true,
);
assert.strictEqual(
  readCardPanUrlFromSources({ card_pan_url: 'https://secure.pagocards.example/pan/1' }),
  'https://secure.pagocards.example/pan/1',
);
assert.strictEqual(readCardPanUrlFromSources({ card_pan_url: 'http://insecure' }), null);

console.log('test-pago-pan-iframe-ui: OK');
