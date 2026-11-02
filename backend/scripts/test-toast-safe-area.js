#!/usr/bin/env node
'use strict';

/**
 * Toast banners respect safe-area and sit below the app header.
 * Run: node backend/scripts/test-toast-safe-area.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const toastJs = fs.readFileSync(path.join(root, 'backend/public/src/components/toast.js'), 'utf8');

assert.ok(css.includes('--toast-top-fallback'), 'toast top fallback variable');
assert.ok(css.includes('--toast-top-auth'), 'auth toast top variable');
assert.ok(/\.auth-toast[\s\S]{0,320}top:\s*var\(--toast-top\)/.test(css), 'auth toast uses --toast-top');
assert.ok(/\.auth-toast[\s\S]{0,400}z-index:\s*10020/.test(css), 'toast stacks above header chrome');
assert.ok(/\.copy-toast[\s\S]{0,280}bottom:\s*var\(--toast-bottom\)/.test(css), 'copy toast respects safe bottom');
assert.ok(css.includes('html.auth-screen-active'), 'auth screen toast override');
assert.ok(!/\.auth-toast[\s\S]{0,80}top:\s*16px/.test(css), 'removed hard-coded 16px top');
assert.ok(toastJs.includes('syncToastViewportInsets'), 'toast helper measures header');
assert.ok(toastJs.includes('--toast-top-measured'), 'measured inset applied on show');
assert.ok(toastJs.includes('auth-screen-active'), 'auth screen class toggled');

console.log('Toast safe-area layout — ok');
