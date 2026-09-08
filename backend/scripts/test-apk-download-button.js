#!/usr/bin/env node
'use strict';

/**
 * Landing APK download button + static file guards.
 * Run: node backend/scripts/test-apk-download-button.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'backend/public');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Landing download markup ==');
const html = read('backend/public/index.html');
assert.ok(html.includes('apk-download-btn'), 'download button class');
assert.ok(html.includes('href="/downloads/eisy-myanmar.apk"'), 'APK href');
assert.ok(/download(?:=["']eisy-myanmar\.apk["']|\b)/.test(html), 'download attribute present');
assert.ok(html.includes('Download App (APK)'), 'button label');
assert.ok(html.includes('apk-download-icon'), 'download icon');
assert.ok(html.includes('auth-apk-download'), 'footer download wrapper');
// Button must sit above legal links, not in the brand/header block.
const brandEnd = html.indexOf('</div>', html.indexOf('auth-brand-sub'));
const btnIdx = html.indexOf('apk-download-btn');
const legalIdx = html.indexOf('auth-legal-links');
assert.ok(btnIdx > brandEnd, 'button is below auth brand header');
assert.ok(btnIdx > 0 && legalIdx > btnIdx, 'button appears just above legal links');
const between = html.slice(btnIdx, legalIdx);
assert.ok(between.includes('Download App (APK)'), 'label is in bottom section');
console.log('ok');

console.log('\n== Styles ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('.apk-download-btn'), 'button style');
assert.ok(css.includes('.auth-apk-download'), 'bottom placement wrapper style');
assert.ok(css.includes('#34d399') || css.includes('emerald'), 'emerald accent');
assert.ok(css.includes('#1e293b'), 'slate background');
console.log('ok');

console.log('\n== Static APK asset ==');
const apkPath = path.join(PUBLIC, 'downloads/eisy-myanmar.apk');
assert.ok(fs.existsSync(apkPath), 'downloads/eisy-myanmar.apk exists');
assert.ok(fs.statSync(apkPath).size > 20, 'APK placeholder not empty');
console.log('ok');

console.log('\nAPK download button checks passed.');
