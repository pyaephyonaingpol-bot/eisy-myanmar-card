#!/usr/bin/env node
'use strict';

/**
 * Login screen stays on primary PIN inputs.
 * OTP login and Forgot PIN stay behind text links.
 * Run: node backend/scripts/test-auth-login-tabs.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8');

const loginStart = html.indexOf('id="panelLogin"');
const registerStart = html.indexOf('id="panelRegister"');
assert.ok(loginStart > 0 && registerStart > loginStart, 'login panel precedes register panel');
const login = html.slice(loginStart, registerStart);

assert.ok(html.includes('id="authTabs"'), 'account tablist');
assert.ok(html.includes('data-tab="login"'), 'login tab');
assert.ok(html.includes('data-tab="register"'), 'register tab');
assert.ok(html.includes('role="tablist"'), 'tablist role');
assert.ok(login.includes('id="loginEmail"'), 'email input');
assert.ok(login.includes('id="loginPin"'), 'PIN input');
assert.ok(login.includes('id="loginPinBtn"'), 'PIN login button');
assert.ok(login.includes('id="loginOtpSection" class="auth-extra hidden"'), 'OTP section starts hidden');
assert.ok(login.includes('id="authPinResetSection" class="auth-extra hidden"'), 'PIN reset starts hidden');
assert.ok(login.includes('class="auth-text-link"'), 'secondary actions are text links');
assert.ok(!login.includes('Use email OTP instead" class="btn'), 'OTP is not a filled button');
assert.ok(!login.includes('Forgot PIN — email reset'), 'forgot PIN is not a large button label');
assert.ok(login.includes('>Forgot PIN<'), 'forgot PIN link remains');
assert.ok(login.includes('>Use email OTP instead<'), 'OTP link remains');
assert.ok(!login.includes('Returning users: enter your PIN'), 'default hint is not always visible');

assert.ok(css.includes('#authTabs.auth-tabs'), 'segmented auth tabs');
assert.ok(css.includes('.auth-quiet-links'), 'quiet link row');
assert.ok(css.includes('.auth-text-link'), 'text link style');

assert.ok(auth.includes('Use email OTP instead'), 'OTP link label');
assert.ok(auth.includes('Hide email OTP'), 'OTP collapse label');
assert.ok(auth.includes('aria-expanded'), 'expanded state');
assert.ok(auth.includes('authPinResetSection'), 'closes PIN reset when OTP opens');

console.log('Auth login tab checks passed.');
