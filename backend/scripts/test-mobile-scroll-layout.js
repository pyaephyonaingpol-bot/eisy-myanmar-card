#!/usr/bin/env node
'use strict';

/**
 * Guards for mobile / WebView document-scroll layout.
 * Run: node backend/scripts/test-mobile-scroll-layout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Global root scroll defaults ==');
const css = read('backend/public/styles.css');
assert.ok(/html\s*\{[^}]*height:\s*100%/s.test(css), 'html height 100%');
assert.ok(/html\s*\{[^}]*min-height:\s*100vh/s.test(css), 'html min-height 100vh');
assert.ok(/html\s*\{[^}]*overflow-y:\s*auto/s.test(css), 'html overflow-y auto');
assert.ok(/body\s*\{[^}]*min-height:\s*100vh/s.test(css), 'body min-height 100vh');
assert.ok(/body\s*\{[^}]*overflow-y:\s*auto/s.test(css), 'body overflow-y auto');
assert.ok(css.includes('@media (min-width: 901px)'), 'desktop fixed shell media query');
assert.ok(css.includes('html.doc-scroll'), 'doc-scroll unlock class');
assert.ok(
  /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*overflow-y:\s*auto\s*!important/m.test(css),
  'mobile media query overflow-y auto'
);
console.log('ok');

console.log('\n== Viewport + critical CSS ==');
const html = read('backend/public/index.html');
assert.ok(/name="viewport"[^>]*width=device-width/i.test(html), 'viewport meta');
assert.ok(html.includes('eisy-mobile-scroll-critical'), 'critical mobile scroll CSS');
assert.ok(html.includes('styles.css?v=20260908mobileScroll'), 'cache-busted styles');
assert.ok(html.includes('viewport.js?v=20260908mobileScroll'), 'cache-busted viewport.js');
const vp = read('backend/public/viewport.js');
assert.ok(vp.includes('doc-scroll'), 'viewport.js toggles doc-scroll');
assert.ok(vp.includes('isAndroidWebView') || vp.includes('Android'), 'WebView detection');
console.log('ok');

console.log('\n== Android WebView injection ==');
const main = read('android/app/src/main/java/com/eisymyanmar/app/MainActivity.java');
assert.ok(main.includes('doc-scroll'), 'adds doc-scroll in WebView');
assert.ok(main.includes('overflow-y:auto') || main.includes("overflow-y:auto!important"),
  'WebView injects overflow-y auto');
assert.ok(main.includes('min-height:100vh'), 'WebView injects min-height 100vh');
console.log('ok');

console.log('\nMobile scroll layout checks passed.');
