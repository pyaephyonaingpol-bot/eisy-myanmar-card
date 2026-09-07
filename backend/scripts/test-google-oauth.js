#!/usr/bin/env node
'use strict';

/**
 * Google OAuth Sign-In wiring guards.
 * Run: node backend/scripts/test-google-oauth.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'backend/public');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('== Google button markup ==');
const html = read('backend/public/index.html');
assert.ok(html.includes('id="googleLoginBtn"'), 'login Google button');
assert.ok(html.includes('id="googleRegisterBtn"'), 'register Google button');
assert.ok((html.match(/data-google-auth/g) || []).length >= 2, 'two Google auth triggers');
assert.ok(html.includes('Continue with Google'), 'Google CTA label');
assert.ok(html.includes('btn-google'), 'Google button class');
assert.ok(html.includes('auth-divider'), 'auth divider');
console.log('ok');

console.log('\n== Frontend OAuth helpers ==');
const authJs = read('backend/public/auth.js');
assert.ok(authJs.includes('loginWithGoogle'), 'Auth.loginWithGoogle');
assert.ok(authJs.includes('completeGoogleOAuth'), 'Auth.completeGoogleOAuth');
assert.ok(authJs.includes('/api/auth/oauth/google'), 'exchanges via backend');
assert.ok(authJs.includes('/auth/callback'), 'redirectTo callback');

const bridge = read('backend/public/src/services/supabaseService.js');
assert.ok(bridge.includes('signInWithOAuth'), 'signInWithOAuth call');
assert.ok(bridge.includes("provider: 'google'"), 'google provider');
assert.ok(bridge.includes('redirectTo'), 'redirectTo option');
assert.ok(bridge.includes('getAuthClient'), 'dedicated auth client');
assert.ok(bridge.includes('exchangeCodeForSession') || bridge.includes('getSession'), 'callback session exchange');

const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('handleGoogleOAuthCallback'), 'callback handler');
assert.ok(dash.includes('data-google-auth'), 'binds Google buttons');
assert.ok(dash.includes('isGoogleOAuthCallback'), 'detects callback path');
console.log('ok');

console.log('\n== Backend route + service ==');
const routes = read('backend/src/routes/auth.js');
assert.ok(routes.includes("'/oauth/google'"), 'oauth/google route');
assert.ok(routes.includes('loginWithGoogleOAuth'), 'calls service');

const service = read('backend/src/services/authService.js');
assert.ok(service.includes('loginWithGoogleOAuth'), 'service export');
assert.ok(service.includes('auth.getUser'), 'verifies Supabase user');
assert.ok(service.includes("provider: 'google'") || service.includes('Google OAuth'), 'google metadata');

const server = read('backend/src/index.js');
assert.ok(server.includes("app.get('/auth/callback'"), 'serves /auth/callback');
console.log('ok');

console.log('\n== CSS ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('.btn-google'), 'google button styles');
assert.ok(css.includes('.auth-divider'), 'divider styles');
console.log('ok');

console.log('\nGoogle OAuth checks passed.');
