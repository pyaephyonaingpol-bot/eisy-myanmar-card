#!/usr/bin/env node
/**
 * P2P sidebar/hash routing must target data-page="p2p", not redirect to cards.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');

function read(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function assertPortalAssetBust(html, file) {
  assert.match(
    html,
    new RegExp(`${file.replace(/\//g, '\\/')}\\?v=20261011p2pRoute-[a-f0-9]{10}`),
    `${file} must use stamped portal cache bust`,
  );
}

console.log('\n== nav.js: P2P route not aliased to cards ==');
const nav = read('nav.js');
assert.ok(
  !/if\s*\(\s*page\s*===\s*['"]p2p['"]\s*\)\s*page\s*=\s*['"]cards['"]/.test(nav),
  'nav.js must not remap p2p → cards',
);
console.log('ok');

for (const file of ['index.html', 'instant.html']) {
  console.log(`\n== ${file}: P2P page + nav wiring ==`);
  const portalHtml = read(file);
  assert.ok(/class="nav-item"[^>]*data-page="p2p"/.test(portalHtml), 'P2P nav item required');
  assert.ok(/id="pageP2p"[^>]*data-page="p2p"/.test(portalHtml), 'pageP2p section with data-page=p2p');
  assert.ok(/name="eisy-portal-assets"/.test(portalHtml), 'portal asset meta tag');
  assertPortalAssetBust(portalHtml, 'dashboard.js');
  assertPortalAssetBust(portalHtml, 'nav.js');
  console.log('ok');
}

console.log('\n== dashboard.js: onPageChange loads P2P ==');
const dash = read('dashboard.js');
assert.ok(/page === 'p2p'/.test(dash) && /loadP2pPage/.test(dash), 'dashboard must load P2P on navigate');
assert.ok(/reconcileAppPageView/.test(dash), 'dashboard must reconcile active app page view');
assert.ok(/syncRouteFromHash/.test(dash), 'dashboard must sync hash routes after auth');
assert.ok(/_activePage/.test(dash), 'dashboard must track active page state');
console.log('ok');

console.log('\n[test-p2p-nav-router] All checks passed.');
