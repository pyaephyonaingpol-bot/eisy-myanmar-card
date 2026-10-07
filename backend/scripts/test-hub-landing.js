#!/usr/bin/env node
'use strict';

/**
 * Root (/) opens the Dashboard and keeps the login gate.
 * /hub redirects home and does not open the hub chooser.
 * Run: node backend/scripts/test-hub-landing.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/src/index.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'backend/public/i18n.js'), 'utf8');

assert.ok(indexHtml.includes('dashboard.js?v=20261007pagoCards'), 'dashboard cache bust');
assert.ok(indexHtml.includes('<title>Eisymyanmar</title>'), 'document title is Eisymyanmar');
assert.ok(indexHtml.includes('class="sidebar-brand-title">Eisymyanmar<'), 'sidebar brand is Eisymyanmar');
assert.ok(indexHtml.includes('class="auth-brand-title">Eisymyanmar<'), 'login header brand is Eisymyanmar');
assert.ok(!indexHtml.includes('Eisy · Instant') && !indexHtml.includes('Eisy • Instant'), 'Instant brand removed from HTML');
assert.ok(indexHtml.includes('id="backToDashboardBtn"'), 'sign-in can return to the dashboard');
assert.ok(indexHtml.includes('id="accountSignInBtn"'), 'account menu can open sign-in');

assert.ok(dash.includes("portalDefaultPage() {\n    return 'home';\n  }"), 'default page is the dashboard');
assert.ok(!dash.includes("return 'instant-card'"), 'login and / do not open Instant');
assert.ok(dash.includes("brandTitle.textContent = 'Eisymyanmar'"), 'sidebar brand script is Eisymyanmar');
assert.ok(!dash.includes('Eisy · Instant'), 'Instant sidebar brand removed');
assert.ok(!dash.includes('Open Instant'), 'header does not offer an Instant redirect');
assert.ok(dash.includes('isHubGateway() {\n    return false;\n  }'), 'hub gateway stays off');
assert.ok(dash.includes("pathName === '/'"), 'root path stays on the dashboard document');
assert.ok(dash.includes("pathName === '/auth/callback'"), 'OAuth callback stays on the dashboard document');
assert.ok(!dash.includes('href="/hub"'), 'header does not link to the hub');

const refreshStart = dash.indexOf('refreshAuthUI() {');
const refreshEnd = dash.indexOf('bindInstantCardUi() {');
const refresh = dash.slice(refreshStart, refreshEnd);
assert.ok(refresh.includes('Root (/) opens the Dashboard and keeps the login gate'), 'logged-out root still shows sign-in');
assert.ok(!refresh.includes('presentHubHome'), 'login does not present the hub');
assert.ok(!refresh.includes('isHubGateway()'), 'login does not take the hub path');

const rootRoute = server.slice(server.indexOf("app.get('/',"), server.indexOf("app.get(['/hub'"));
assert.ok(rootRoute.includes('sendPortalApp'), 'root serves the dashboard app');
assert.ok(!rootRoute.includes('redirect'), 'root does not redirect into another view');
assert.ok(server.includes("app.get(['/hub', '/dashboard']"), 'hub route exists');
assert.ok(/app\.get\(\['\/hub', '\/dashboard'\],[\s\S]*redirect\(\s*302\s*,\s*'\/'\)/.test(server), 'hub redirects home');
assert.ok(server.includes("app.get(['/instant', '/instant.html']"), '/instant stays available');
assert.ok(server.includes('<title>Eisymyanmar</title>'), 'served title is Eisymyanmar');

assert.ok(i18n.includes("account_sign_in: 'Sign in'"), 'english sign-in label');
assert.ok(i18n.includes("account_sign_in: 'အကောင့်ဝင်ရန်'"), 'myanmar sign-in label');

console.log('dashboard landing checks passed');
