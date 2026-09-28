/**
 * My Cards must not nest Instant↔Business toggles —
 * pipelines are separated only at /instant and /business routes.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testMyCardsHasNoNestedSwitcher() {
  section('My Cards HTML has route CTAs, not nested mode switch shell');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
  assert.ok(html.includes('id="cardsApplyCta"'));
  assert.ok(html.includes('data-portal-cta="instant"'));
  assert.ok(html.includes('data-portal-cta="standard"'));
  assert.ok(!html.includes('id="appModeSwitcherShell"'), 'My Cards must not host appModeSwitcherShell');
  assert.ok(!html.includes('id="cardProviderSwitchShell"'), 'My Cards must not host cardProviderSwitchShell');
  // Page still has dedicated Instant/Business page hosts elsewhere
  assert.ok(html.includes('id="instantAppPageHost"'));
  assert.ok(html.includes('id="standardAppPageHost"'));
  assert.ok(html.includes('href="/business"') || html.includes("href='/business'"));
  console.log('ok');
}

function testDashboardNeverMountsSwitcherOnCards() {
  section('dashboard does not mount nested Instant↔Business switch on My Cards');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('syncCardsApplyCtas'));
  assert.ok(dash.includes('renderPortalHeaderNav'));
  assert.ok(dash.includes('cardsApplyCta'));
  assert.ok(!dash.includes("mountAppModeUi('switch')"), 'must not mount switch mode into My Cards');
  assert.ok(!dash.includes('mountInto($(\'appModeSwitcherShell\')'));
  assert.ok(!dash.includes('appModeSwitcher.mountInto'));
  assert.ok(!dash.includes('appModeSwitcher.mountCompact'));
  assert.ok(
    dash.includes('portalHref')
      || dash.includes("window.location.href = `/${mode}`")
      || dash.includes("window.location.href = '/'+mode")
  );
  // setAppMode should route to portals on hub
  assert.ok(dash.includes('Route-level separation') || dash.includes('dedicated portal'));
  console.log('ok');
}

function testPortalHeaderIsLinksNotToggle() {
  section('header uses portal links, not in-app Noon toggle');
  const dash = fs.readFileSync(path.join(ROOT, 'backend/public/dashboard.js'), 'utf8');
  assert.ok(dash.includes('portal-switch-link'));
  assert.ok(dash.includes('renderPortalHeaderNav'));
  assert.ok(dash.includes("href=\"/instant\""));
  assert.ok(dash.includes("href=\"/business\"") || dash.includes("href='/business'"));
  console.log('ok');
}

function main() {
  testMyCardsHasNoNestedSwitcher();
  testDashboardNeverMountsSwitcherOnCards();
  testPortalHeaderIsLinksNotToggle();
  console.log('\nMy Cards nested-toggle cleanup checks passed.');
}

main();
