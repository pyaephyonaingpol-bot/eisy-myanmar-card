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
assert.ok(authJs.includes('recoverGoogleAccessToken'), 'Auth.recoverGoogleAccessToken');
assert.ok(authJs.includes('waitForSupabaseBridge'), 'waits for bridge before PKCE exchange');
assert.ok(authJs.includes("storageKey: 'eisy-supabase-auth'"), 'shared Supabase auth storageKey');
assert.ok(authJs.includes('getSupabasePublicConfig'), 'reads public Supabase config');
assert.ok(authJs.includes('supabaseConfigError'), 'typed config errors');
assert.ok(!authJs.includes('Supabase is not configured'), 'no generic false-negative banner text');
assert.ok(authJs.includes('/api/auth/oauth/google'), 'exchanges via backend');
assert.ok(authJs.includes('/auth/callback'), 'redirectTo callback');
// Direct fallback must prefer getSession before re-exchanging a one-time code.
const recoverIdx = authJs.indexOf('async recoverGoogleAccessToken');
const recoverBlock = authJs.slice(recoverIdx, recoverIdx + 2200);
const getSessionIdx = recoverBlock.indexOf('client.auth.getSession()');
const exchangeIdx = recoverBlock.indexOf('client.auth.exchangeCodeForSession');
assert.ok(getSessionIdx > 0 && exchangeIdx > getSessionIdx, 'fallback getSession before re-exchange');

const bridge = read('backend/public/src/services/supabaseService.js');
assert.ok(bridge.includes('signInWithOAuth'), 'signInWithOAuth call');
assert.ok(bridge.includes("provider: 'google'"), 'google provider');
assert.ok(bridge.includes('redirectTo'), 'redirectTo option');
assert.ok(bridge.includes('getAuthClient'), 'dedicated auth client');
assert.ok(bridge.includes('__EISY_SUPABASE_PUBLIC__'), 'uses baked public config');
assert.ok(bridge.includes('force'), 'supports forced re-init');
assert.ok(bridge.includes('pkceExchangeArgs'), 'exchanges the raw PKCE code');
assert.ok(bridge.includes('mapGoogleOAuthExchangeError') || bridge.includes('Unable to exchange external code'), 'maps GoTrue exchange errors');
assert.ok(!bridge.includes('exchangeCodeForSession(window.location.href)'), 'callback URL is not the auth code');
assert.ok(!bridge.includes('Supabase is not configured'), 'bridge avoids generic false-negative text');
assert.ok(bridge.includes('One-time code may already have been consumed'), 'recovers session after raced exchange');
assert.ok(bridge.includes("storageKey: 'eisy-supabase-auth'"), 'bridge uses shared storageKey');

const proxyLib = read('backend/src/lib/supabase.js');
assert.ok(proxyLib.includes('never rewrite Google OAuth'), 'proxy docs warn against redirect_uri rewrite');
assert.ok(fs.existsSync(path.join(ROOT, 'backend/docs/GOOGLE_OAUTH.md')), 'Google OAuth runbook');

assert.ok(html.includes('supabase-public-config.js'), 'loads baked public config script');
assert.ok(html.includes('oauthFirstLogin') || html.includes('auth.js?v='), 'auth script cache-bust');
const baked = read('backend/public/supabase-public-config.js');
assert.ok(baked.includes('__EISY_SUPABASE_PUBLIC__'), 'baked config global');

const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('handleGoogleOAuthCallback'), 'callback handler');
assert.ok(dash.includes('data-google-auth'), 'binds Google buttons');
assert.ok(dash.includes('isGoogleOAuthCallback'), 'detects callback path');
assert.ok(dash.includes("params.get('code')"), 'detects ?code= outside /auth/callback');
assert.ok(dash.includes('if (supportForm) supportForm.onsubmit'), 'missing support form cannot abort init');
const oauthBoot = dash.indexOf('await this.handleGoogleOAuthCallback()');
assert.ok(oauthBoot > 0, 'boot awaits Google callback');
assert.ok(dash.slice(oauthBoot, oauthBoot + 280).includes('finishBoot()'), 'finishBoot after Google success');
const bootCall = dash.indexOf('boot()');
const dashboardBind = dash.indexOf('this.bindDashboardForms();');
assert.ok(bootCall > 0 && dashboardBind > bootCall, 'Google callback starts before hub form binds');

const nextShim = read('app/auth/callback/route.ts');
assert.ok(nextShim.includes('/auth/callback'), 'Next callback shim points at SPA path');
assert.ok(nextShim.includes('Do not rely on this file as the live handler'), 'Next shim documents Express SPA');
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
assert.ok(server.includes("app.use('/supabase'"), 'mounts same-origin Supabase proxy');
const vercel = read('vercel.json');
assert.ok(vercel.includes('"/supabase/(.*)"'), 'vercel rewrites /supabase to API');
console.log('ok');

console.log('\n== CSS ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('.btn-google'), 'google button styles');
assert.ok(css.includes('.auth-divider'), 'divider styles');
console.log('ok');

console.log('\nGoogle OAuth checks passed.');
