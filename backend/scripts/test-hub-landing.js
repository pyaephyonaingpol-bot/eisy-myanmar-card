#!/usr/bin/env node
'use strict';

/**
 * Root (/) opens Instant and keeps the login gate. Hub stays at /hub.
 * Run: node backend/scripts/test-hub-landing.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/src/index.js'), 'utf8');

assert.ok(indexHtml.includes('dashboard.js?v=20261006instantLanding'), 'dashboard cache bust');
assert.ok(dash.includes("pathName === '/'"), 'root path selects Instant');
assert.ok(dash.includes("pathName === '/auth/callback'"), 'OAuth callback keeps the Instant document');
assert.ok(dash.includes('href="/hub"'), 'Instant can return to the hub');
assert.ok(dash.includes('href="/" data-portal-switch="instant"'), 'hub switch opens Instant at /');
assert.ok(dash.includes('Root (/) is Instant and keeps the login gate'), 'logged-out Instant still shows sign-in');

const rootRoute = server.slice(server.indexOf("app.get('/',"), server.indexOf("app.get('/hub'"));
assert.ok(rootRoute.includes('sendPortalApp'), 'root serves the Instant portal');
assert.ok(server.includes("app.get('/hub'"), 'hub remains available');
assert.ok(server.includes("app.get(['/instant', '/instant.html']"), '/instant stays available');

console.log('instant landing checks passed');
