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
assert.ok(/\.sidebar-toggle[\s\S]{0,120}z-index:\s*130/.test(css), 'toggle above overlays');
console.log('ok');

console.log('\n== Email PIN / password reset ==');
const html = read('backend/public/index.html');
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
