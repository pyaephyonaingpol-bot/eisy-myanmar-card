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
assert.ok(authJs.includes('getSupabasePublicConfig'), 'reads public Supabase config');
assert.ok(authJs.includes('supabaseConfigError'), 'typed config errors');
assert.ok(!authJs.includes('Supabase is not configured'), 'no generic false-negative banner text');
assert.ok(authJs.includes('/api/auth/oauth/google'), 'exchanges via backend');
assert.ok(authJs.includes('/auth/callback'), 'redirectTo callback');

const bridge = read('backend/public/src/services/supabaseService.js');
assert.ok(bridge.includes('signInWithOAuth'), 'signInWithOAuth call');
assert.ok(bridge.includes("provider: 'google'"), 'google provider');
assert.ok(bridge.includes('redirectTo'), 'redirectTo option');
assert.ok(bridge.includes('getAuthClient'), 'dedicated auth client');
assert.ok(bridge.includes('__EISY_SUPABASE_PUBLIC__'), 'uses baked public config');
assert.ok(bridge.includes('force'), 'supports forced re-init');
assert.ok(bridge.includes('exchangeCodeForSession'), 'callback code exchange');
assert.ok(bridge.includes('pkceExchangeArgs'), 'exchanges the raw code, not the callback URL');
assert.ok(!bridge.includes('exchangeCodeForSession(window.location.href)'), 'full callback URL is not the auth code');
assert.ok(bridge.includes('@supabase/supabase-js@2.112.4'), 'browser SDK matches exchangeCodeForSession(code)');
assert.ok(bridge.includes('getSession'), 'falls back when the code was already exchanged');
assert.ok(bridge.includes('skipBrowserRedirect: true'), 'stores PKCE verifier before navigation');
assert.ok(bridge.includes('detectSessionInUrl: false'), 'manual exchange is the only callback reader');
assert.ok(!bridge.includes('Supabase is not configured'), 'bridge avoids generic false-negative text');
assert.ok(authJs.includes('detectSessionInUrl: false'), 'direct client does not auto-consume the code');
assert.ok(authJs.includes('skipBrowserRedirect: true'), 'direct client redirects after PKCE storage');
assert.ok(authJs.includes('exchangeCodeForSession(code, flowId'), 'direct client exchanges the raw code');
assert.ok(authJs.includes("searchParams.get('sb_flow_id')"), 'direct client keeps the PKCE flow id');
assert.ok(!authJs.includes('exchangeCodeForSession(window.location.href)'), 'direct client does not send the callback URL as auth_code');
assert.ok(authJs.includes('@supabase/supabase-js@2.112.4'), 'direct client uses the pinned SDK');

assert.ok(html.includes('supabase-public-config.js'), 'loads baked public config script');
const baked = read('backend/public/supabase-public-config.js');
assert.ok(baked.includes('__EISY_SUPABASE_PUBLIC__'), 'baked config global');

const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('handleGoogleOAuthCallback'), 'callback handler');
assert.ok(dash.includes('data-google-auth'), 'binds Google buttons');
assert.ok(dash.includes('isGoogleOAuthCallback'), 'detects callback path');
assert.ok(!dash.includes('onAuthStateChange'), 'session exchange is explicit, not an auth listener');
const bootCall = dash.indexOf('boot()');
const dashboardBind = dash.indexOf('this.bindDashboardForms();');
assert.ok(bootCall > 0 && dashboardBind > bootCall, 'Google callback starts before hub form binds');
assert.ok(dash.includes('if (supportForm) supportForm.onsubmit'), 'missing support form cannot abort init');
console.log('ok');

console.log('\n== Backend route + service ==');
const routes = read('backend/src/routes/auth.js');
assert.ok(routes.includes("'/oauth/google'"), 'oauth/google route');
assert.ok(routes.includes('loginWithGoogleOAuth'), 'calls service');

const service = read('backend/src/services/authService.js');
assert.ok(service.includes('loginWithGoogleOAuth'), 'service export');
assert.ok(service.includes('auth.getUser'), 'verifies Supabase user');
assert.ok(service.includes('verifySupabaseJwtLocally'), 'local ES256/HS256 verify before getUser');
const jwtLib = read('backend/src/lib/supabaseJwt.js');
assert.ok(jwtLib.includes("alg === 'ES256'"), 'accepts ES256 access tokens');
assert.ok(jwtLib.includes("alg === 'HS256'"), 'HMAC only for HS256 tokens');
assert.ok(service.includes('jwks.json'), 'loads project JWKS');
assert.ok(routes.includes('GOOGLE_TOKEN_TIMEOUT'), 'timeout is its own status');
assert.ok(service.includes("provider: 'google'") || service.includes('Google OAuth'), 'google metadata');

const server = read('backend/src/index.js');
assert.ok(server.includes("app.get('/auth/callback'"), 'serves /auth/callback');
console.log('ok');

console.log('\n== CSS ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('.btn-google'), 'google button styles');
assert.ok(css.includes('.auth-divider'), 'divider styles');
console.log('ok');

async function assertPkceArgs() {
  console.log('\n== PKCE code is not the callback URL ==');
  const { readGoogleOAuthCallback, pkceExchangeArgs } = await import('../public/src/lib/googleOAuthCallback.mjs');
  const href = 'https://eisymyanmar.com/auth/callback?code=auth-code-1&sb_flow_id=flow-1';
  const parsed = readGoogleOAuthCallback(href);
  assert.strictEqual(parsed.code, 'auth-code-1');
  assert.strictEqual(parsed.flowId, 'flow-1');
  assert.deepStrictEqual(pkceExchangeArgs(parsed), ['auth-code-1', { flowId: 'flow-1' }]);
  assert.notStrictEqual(pkceExchangeArgs(parsed)[0], href);
  const cancelled = readGoogleOAuthCallback('https://www.eisymyanmar.com/auth/callback?error=access_denied&error_description=User%20cancelled');
  assert.strictEqual(cancelled.errorMessage, 'User cancelled');
  assert.strictEqual(pkceExchangeArgs(cancelled), null);
  const plain = readGoogleOAuthCallback('https://eisymyanmar.com/auth/callback?code=only-code');
  assert.deepStrictEqual(pkceExchangeArgs(plain), ['only-code', undefined]);
  console.log('ok');
}

assertPkceArgs()
  .then(() => console.log('\nGoogle OAuth checks passed.'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
