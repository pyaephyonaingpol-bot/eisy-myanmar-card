#!/usr/bin/env node
'use strict';

/**
 * Guards for strict Android / mobile document-scroll unlock.
 * Run: node backend/scripts/test-mobile-scroll-layout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Strict root unlock ==');
const css = read('backend/public/styles.css');
assert.ok(css.includes('html:not(.doc-scroll)'), 'desktop shell gated behind :not(.doc-scroll)');
assert.ok(/html\.doc-scroll\s*\{[^}]*height:\s*auto\s*!important/s.test(css), 'doc-scroll html height auto');
assert.ok(/html\.doc-scroll\s*\{[^}]*min-height:\s*100%\s*!important/s.test(css), 'doc-scroll html min-height 100%');
assert.ok(/html\.doc-scroll\s*\{[^}]*overflow-y:\s*auto\s*!important/s.test(css), 'doc-scroll html overflow-y auto');
assert.ok(/html\.doc-scroll body\s*\{[^}]*height:\s*auto\s*!important/s.test(css), 'doc-scroll body height auto');
assert.ok(/html\.doc-scroll body\s*\{[^}]*overflow-y:\s*auto\s*!important/s.test(css), 'doc-scroll body overflow-y auto');
assert.ok(/STRICT Android \/ mobile document-scroll unlock/i.test(css), 'last-wins strict block present');
assert.ok(exists('backend/public/android-scroll-fix.css'), 'android-scroll-fix.css exists');
const fix = read('backend/public/android-scroll-fix.css');
assert.ok(/overflow-y:\s*auto\s*!important/.test(fix), 'fix sheet overflow-y auto');
assert.ok(/height:\s*auto\s*!important/.test(fix), 'fix sheet height auto');
assert.ok(/min-height:\s*100%\s*!important/.test(fix), 'fix sheet min-height 100%');
console.log('ok');

console.log('\n== HTML wiring ==');
const html = read('backend/public/index.html');
assert.ok(html.includes('android-scroll-fix.css'), 'loads android-scroll-fix.css');
assert.ok(html.includes('styles.css?v=20260908strictScroll'), 'cache-busted styles');
assert.ok(html.includes("classList.add('doc-scroll')"), 'early doc-scroll bootstrap');
assert.ok(html.includes("setProperty('overflow-y', 'auto', 'important')"), 'inline overflow-y unlock');
console.log('ok');

console.log('\n== Android WebView injection ==');
const main = read('android/app/src/main/java/com/eisymyanmar/app/MainActivity.java');
assert.ok(main.includes('height:auto!important'), 'WebView height auto');
assert.ok(main.includes('min-height:100%!important'), 'WebView min-height 100%');
assert.ok(main.includes('overflow-y:auto!important'), 'WebView overflow-y auto');
console.log('ok');

console.log('\nStrict mobile scroll checks passed.');
