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
console.log('ok');

console.log('\n== Styles ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('.apk-download-btn'), 'button style');
assert.ok(css.includes('#34d399') || css.includes('emerald'), 'emerald accent');
assert.ok(css.includes('#1e293b'), 'slate background');
console.log('ok');

console.log('\n== Static APK asset ==');
const apkPath = path.join(PUBLIC, 'downloads/eisy-myanmar.apk');
assert.ok(fs.existsSync(apkPath), 'downloads/eisy-myanmar.apk exists');
assert.ok(fs.statSync(apkPath).size > 20, 'APK placeholder not empty');
console.log('ok');

console.log('\nAPK download button checks passed.');
