#!/usr/bin/env node
/**
 * Profile + Settings & Security belong in the account dropdown only —
 * not in the left sidebar / drawer nav.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function sidebarNav(html) {
  const start = html.indexOf('id="userSidebar"');
  assert.ok(start >= 0, 'userSidebar required');
  const navStart = html.indexOf('<nav', start);
  const navEnd = html.indexOf('</nav>', navStart);
  assert.ok(navStart > start && navEnd > navStart, 'sidebar nav required');
  return html.slice(navStart, navEnd);
}

function accountMenu(html) {
  const start = html.indexOf('id="accountMenuPanel"');
  assert.ok(start >= 0, 'accountMenuPanel required');
  const end = html.indexOf('</div>', html.indexOf('id="logoutBtn"', start));
  assert.ok(end > start, 'account menu panel end required');
  return html.slice(start, end);
}

function testIndexHtml() {
  section('index.html: sidebar drops Profile/Settings; account menu keeps them');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const nav = sidebarNav(html);
  const menu = accountMenu(html);

  assert.ok(!/data-page="profile"/.test(nav), 'sidebar must not include Profile nav item');
  assert.ok(!/data-page="settings"/.test(nav), 'sidebar must not include Settings nav item');
  assert.ok(!/nav_profile/.test(nav), 'sidebar must not i18n Profile');
  assert.ok(!/nav_settings/.test(nav), 'sidebar must not i18n Settings');

  assert.ok(/data-goto="profile"/.test(menu), 'account menu must keep Profile');
  assert.ok(/data-goto="settings"/.test(menu), 'account menu must keep Settings');
  assert.ok(/nav_profile/.test(menu), 'account menu Profile i18n');
  assert.ok(/nav_settings/.test(menu), 'account menu Settings i18n');

  // Pages themselves remain reachable
  assert.ok(/id="pageProfile"/.test(html), 'Profile page must remain');
  assert.ok(/id="pageSettings"/.test(html), 'Settings page must remain');
  console.log('ok');
}

function testPortalShells() {
  section('instant portal mirrors sidebar cleanup');
  const portal = 'instant.html';
  const html = fs.readFileSync(path.join(ROOT, 'public', portal), 'utf8');
  const nav = sidebarNav(html);
  const menu = accountMenu(html);
  assert.ok(!/data-page="profile"/.test(nav), `${portal}: no sidebar Profile`);
  assert.ok(!/data-page="settings"/.test(nav), `${portal}: no sidebar Settings`);
  assert.ok(/data-goto="profile"/.test(menu), `${portal}: account menu Profile`);
  assert.ok(/data-goto="settings"/.test(menu), `${portal}: account menu Settings`);
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'standard.html')), 'standard portal removed');
  console.log('ok');
}

function main() {
  testIndexHtml();
  testPortalShells();
  console.log('\nSidebar nav cleanup checks passed.');
}

main();
