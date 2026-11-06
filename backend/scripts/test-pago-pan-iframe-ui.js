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
assert.ok(dash.includes('renderPagoPanIframe'), 'dashboard hides hosted iframe by default');
assert.ok(dash.includes('mergePagoSensitiveCard'), 'dashboard merges sensitive card API fields');
assert.ok(dash.includes('mountPagoPanIframeSrc'), 'dashboard mounts iframe src');
assert.ok(dash.includes('pagoCardPanFrame'), 'dashboard references iframe element');
assert.ok(dash.includes('isTrustedPagoPanUrl'), 'dashboard validates Pagocards pan URL host');
assert.ok(dash.includes('upsertPagoCardInList'), 'dashboard persists pan URL on card state');
assert.ok(!html.includes('referrerpolicy="no-referrer"'), 'iframe keeps referrer for Pagocards');

const { usesPagoPanIframe, readCardPanUrlFromSources } = require('../src/services/pagoPanView');
assert.strictEqual(
  usesPagoPanIframe({ provider: 'pago', product_code: 'us_493_visa_bin_v2' }),
  false,
);
process.env.PAGO_CARD_FORCE_PAN_IFRAME = '1';
delete require.cache[require.resolve('../src/services/pagoPanView')];
const pagoPanForced = require('../src/services/pagoPanView');
assert.strictEqual(
  pagoPanForced.usesPagoPanIframe({ provider: 'pago', product_code: 'us_493_visa_bin_v2' }),
  true,
);
delete process.env.PAGO_CARD_FORCE_PAN_IFRAME;
delete require.cache[require.resolve('../src/services/pagoPanView')];
assert.strictEqual(
  readCardPanUrlFromSources({ card_pan_url: 'https://secure.pagocards.example/pan/1' }),
  'https://secure.pagocards.example/pan/1',
);
assert.strictEqual(readCardPanUrlFromSources({ card_pan_url: 'http://insecure' }), null);
assert.strictEqual(
  readCardPanUrlFromSources({
    card_pan_url: 'https://cards.cardapi.vip/display/abc#secret=signed',
  }),
  'https://cards.cardapi.vip/display/abc#secret=signed',
);
const { needsPagoPanUrlFetch } = require('../src/services/pagoPanView');
assert.strictEqual(needsPagoPanUrlFetch({ product_code: 'us_493_visa_bin_v2' }), false);

console.log('test-pago-pan-iframe-ui: OK');
