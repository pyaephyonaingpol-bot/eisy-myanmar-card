#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dash = fs.readFileSync(path.join(root, 'public/dashboard.js'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'public/nav.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'public/auth.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.ok(nav.includes('page === this.currentPage'), 'nav skips same-page navigate');
assert.ok(nav.includes('hashchange echoes'), 'nav documents hash echo guard');

assert.ok(dash.includes("reloads:"), 'TTL includes reloads');
assert.ok(dash.includes("p2p:"), 'TTL includes p2p');
assert.ok(dash.includes("kyc:"), 'TTL includes kyc');
assert.ok(dash.includes('_hydrating'), 'hydration flag tracked');
assert.ok(
  dash.indexOf('const hydrateToken = this.beginHydration()') < dash.indexOf('this.initNavigationIfNeeded()', dash.indexOf('refreshAuthUI')),
  'beginHydration runs before initNavigationIfNeeded in refreshAuthUI'
);
assert.ok(
  dash.includes("if (!forceRefresh && this._isFresh('cards'))"),
  'empty card lists still honor cards TTL'
);
assert.ok(dash.includes('!this._hydrating || force'), 'home skips loads while hydrating');
assert.ok(dash.includes("Honor cards TTL"), 'loadAllCards honors TTL');
assert.ok(dash.includes("Dashboard no longer mounts #txHistory") || dash.includes('avoid a wasted round-trip'), 'loadTransactions short-circuits without DOM');
assert.ok(dash.includes("setPageLoading"), 'page loading helper exists');
assert.ok(dash.includes('visibilityRefreshTimer') || dash.includes('_visibilityRefreshTimer'), 'visibility refresh debounced');
assert.ok(dash.includes("if (!force && this._isFresh('p2p'))"), 'p2p page respects TTL');

assert.ok(auth.includes('__EISY_DEBUG_API'), 'Auth.api logs gated behind debug flag');
assert.ok(!/#txHistory\b/.test(html) && !/id="txHistory"/.test(html), 'txHistory not in HTML (dead fetch target)');
assert.ok(css.includes('is-page-loading'), 'page loading skeleton styles present');
assert.ok(css.includes('content-visibility: auto'), 'offscreen pages use content-visibility');

console.log('ok — user app performance guards in place');
