#!/usr/bin/env node
'use strict';

/**
 * Guards for mobile menu toggle, email PIN/password reset, and post-registration PIN setup.
 * Run: node backend/scripts/test-mobile-menu-pin-reset.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('== Mobile menu wiring ==');
const nav = read('backend/public/nav.js');
assert.ok(nav.includes('toggleMobileSidebar'), 'toggle helper');
assert.ok(nav.includes('[data-sidebar-toggle]'), 'delegated toggle selector');
assert.ok(nav.includes('force: true') || nav.includes('{ force: true }') || nav.includes('force = false'), 'force toggle support');

const css = read('backend/public/styles.css');
assert.ok(css.includes('.app-shell.sidebar-open .sidebar-backdrop'), 'open backdrop rule');
assert.ok(css.includes('visibility: hidden') || css.includes('display: none'), 'closed backdrop not hit-testable');
assert.ok(/sidebar-open \.sidebar-backdrop[\s\S]{0,220}inset:\s*0/.test(css)
  || /sidebar-open \.sidebar-backdrop[\s\S]{0,220}top:\s*0/.test(css), 'full-screen open backdrop');
assert.ok(css.includes('background-color: #0F172A') || css.includes('background-color:#0F172A'), 'solid sidebar fill');
assert.ok(nav.includes('_sidebarDelegateBound') || nav.includes('data-sidebar-toggle'), 'toggle click wiring');
assert.ok(nav.includes('sidebar-toggle-fab') || nav.includes('ensureSidebarFab'), 'floating close control above overlay');
assert.ok(css.includes('--sidebar-safe-top'), 'sidebar safe-area token');
assert.ok(
  css.includes('max(3rem, calc(var(--safe-top) + 0.75rem))'),
  'sidebar safe-top uses pt-12 floor plus device inset'
);
assert.ok(css.includes('padding-top: var(--sidebar-safe-top)'), 'drawer uses safe-area top padding');
assert.ok(css.includes('top: var(--sidebar-safe-top)'), 'fab sits below status bar');
assert.ok(
  css.includes('.app-shell.sidebar-open .header-logo-mobile'),
  'header logo hidden while drawer open (avoids duplicate mark)'
);
assert.ok(
  /sidebar-open \.app-sidebar \.sidebar-brand[\s\S]{0,80}padding-left:\s*3\.15rem/.test(css),
  'open drawer brand clears floating close control'
);
const indexHtml = read('backend/public/index.html');
assert.ok(!indexHtml.includes('<<<<<<<') && !indexHtml.includes('>>>>>>>'), 'no git conflict markers in index.html');
const adminHtml = read('backend/public/admin.html');
assert.ok(!adminHtml.includes('<<<<<<<') && !adminHtml.includes('>>>>>>>'), 'no git conflict markers in admin.html');
console.log('ok');

console.log('\n== Email PIN / password reset ==');
const html = indexHtml;
assert.ok(html.includes('pinForgotBtn') || html.includes('Forgot PIN — email reset'), 'forgot PIN CTA');
assert.ok(html.includes('pinResetEmailSection'), 'PIN email reset section');
assert.ok(html.includes('passwordResetSection') || html.includes('Forgot password — email reset'), 'password email reset');
assert.ok(!html.includes('Reset to 123456'), 'no default PIN reset button in UI');

const authJs = read('backend/public/auth.js');
assert.ok(authJs.includes('sendPinResetOtp'), 'Auth.sendPinResetOtp');
assert.ok(authJs.includes('completePinReset'), 'Auth.completePinReset');
assert.ok(authJs.includes('sendPasswordResetOtp'), 'Auth.sendPasswordResetOtp');
assert.ok(authJs.includes('completePasswordReset'), 'Auth.completePasswordReset');
assert.ok(authJs.includes('/api/auth/pin/reset/send-otp'), 'PIN reset send route');
assert.ok(authJs.includes('/api/auth/password/reset/send-otp'), 'password reset send route');

const routes = read('backend/src/routes/auth.js');
assert.ok(routes.includes("/pin/reset/send-otp"), 'pin reset send route');
assert.ok(routes.includes("/pin/reset/confirm"), 'pin reset confirm route');
assert.ok(routes.includes("/password/reset/send-otp"), 'password reset send route');
assert.ok(routes.includes("/password/reset/confirm"), 'password reset confirm route');

const service = read('backend/src/services/authService.js');
assert.ok(service.includes('sendPinResetOtp'), 'service sendPinResetOtp');
assert.ok(service.includes("purpose: 'reset_pin'"), 'reset_pin purpose');
assert.ok(service.includes("purpose: 'reset_password'"), 'reset_password purpose');
assert.ok(service.includes('PIN_RESET_EMAIL_REQUIRED') || service.includes('email OTP to reset'), 'default reset gated');
console.log('ok');

console.log('\n== Post-registration PIN setup ==');
assert.ok(service.includes('needs_pin_setup'), 'needs_pin_setup flag');
assert.ok(service.includes('pinHash: pinValue ? hashPin(pinValue) : null'), 'optional registration PIN');
assert.ok(html.includes('setupPinConfirm'), 'confirm PIN on setup modal');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('openPinSetupModal'), 'openPinSetupModal helper');
assert.ok(dash.includes('!Auth.user?.has_pin'), 'robust has_pin check');
assert.ok(dash.includes('Auth.setPin(pin)'), 'saves PIN via Auth.setPin');
console.log('ok');

console.log('\nMobile menu / PIN reset / setup checks passed.');
