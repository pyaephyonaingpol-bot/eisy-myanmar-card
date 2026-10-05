#!/usr/bin/env node
'use strict';

/**
 * Root (/) opens the dashboard. Instant keeps the login gate.
 * Run: node backend/scripts/test-hub-landing.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');

const authTag = indexHtml.match(/<div id="authScreen"[^>]*>/);
const dashTag = indexHtml.match(/<div id="dashboardScreen"[^>]*>/);
assert.ok(authTag, 'auth screen exists');
assert.ok(dashTag, 'dashboard screen exists');
assert.ok(/\bhidden\b/.test(authTag[0]), 'login screen starts hidden on /');
assert.ok(!/\bhidden\b/.test(dashTag[0]), 'dashboard is the default view on /');
assert.ok(indexHtml.includes('id="backToDashboardBtn"'), 'sign-in can return to the dashboard');
assert.ok(indexHtml.includes('id="accountSignInBtn"'), 'account menu can open sign-in');
assert.ok(indexHtml.includes('dashboard.js?v=20261005hubLanding'), 'dashboard cache bust');

assert.ok(dash.includes('presentHubHome()'), 'hub landing helper');
assert.ok(dash.includes('showHubSignIn()'), 'hub sign-in helper');
const presentStart = dash.indexOf('presentHubHome() {');
const present = dash.slice(presentStart, presentStart + 900);
assert.ok(present.includes("authScreen.classList.add('hidden')"), 'hub home hides the login wall');
assert.ok(present.includes("dashboardScreen.classList.remove('hidden')"), 'hub home shows the dashboard');
assert.ok(dash.includes('if (this.isHubGateway())'), 'root path is special-cased');
assert.ok(dash.includes('Instant keeps the login gate'), 'instant portal stays gated');

assert.ok(i18n.includes("account_sign_in: 'Sign in'"), 'english sign-in label');
assert.ok(i18n.includes("account_sign_in: 'အကောင့်ဝင်ရန်'"), 'myanmar sign-in label');

console.log('hub landing checks passed');
