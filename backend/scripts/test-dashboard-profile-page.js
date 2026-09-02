#!/usr/bin/env node
'use strict';

/**
 * Guard: home dashboard must not host profile summary boxes;
 * Profile page owns Name/Email/Phone/Selected Card/Card Status + edit form.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const dashPath = path.join(__dirname, '..', 'public', 'dashboard.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const dash = fs.readFileSync(dashPath, 'utf8');

function betweenMarkers(startNeedle, endNeedle) {
  const start = html.indexOf(startNeedle);
  assert(start >= 0, `missing start marker: ${startNeedle}`);
  const end = html.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, `missing end marker after ${startNeedle}: ${endNeedle}`);
  return html.slice(start, end);
}

const home = betweenMarkers('id="pageHome"', 'id="pageCards"');
const profile = betweenMarkers('id="pageProfile"', 'id="pageSettings"');
const settings = betweenMarkers('id="pageSettings"', '</main>');

assert(!/id="sumName"/.test(home), 'home must not contain sumName');
assert(!/id="sumEmail"/.test(home), 'home must not contain sumEmail');
assert(!/id="sumPhone"/.test(home), 'home must not contain sumPhone');
assert(!/id="sumCard"/.test(home), 'home must not contain sumCard');
assert(!/id="sumCardStatus"/.test(home), 'home must not contain sumCardStatus');
assert(!/id="profileForm"/.test(home), 'home must not contain profileForm');

assert(/id="sumName"/.test(profile), 'profile must contain sumName');
assert(/id="sumEmail"/.test(profile), 'profile must contain sumEmail');
assert(/id="sumPhone"/.test(profile), 'profile must contain sumPhone');
assert(/id="sumCard"/.test(profile), 'profile must contain sumCard');
assert(/id="sumCardStatus"/.test(profile), 'profile must contain sumCardStatus');
assert(/id="profileForm"/.test(profile), 'profile must contain profileForm');

assert(!/id="profileForm"/.test(settings), 'settings must not host profileForm');
assert(/data-goto="profile"/.test(settings), 'settings should link to profile');

assert(/data-page="profile"/.test(html), 'nav/page profile required');
assert(/data-page-title="profile"/.test(html), 'page title for profile required');
assert(/id="sumBalanceUsdt"/.test(home), 'home must keep wallet balance');
assert(/home-card-purchase/.test(home), 'home must keep card purchase panel');
assert(!/quick_actions/.test(home), 'home must not contain redundant quick actions panel');
assert(!/btnSellConvertUsdtQuick/.test(home), 'home must not duplicate sell-usdt quick button');

assert(/page === 'profile'/.test(dash), 'dashboard onPageChange must handle profile');
assert(/updateProfileFormUI\(\)/.test(dash), 'profile form UI updater must remain');

console.log('DASHBOARD PROFILE PAGE GUARD PASSED');
