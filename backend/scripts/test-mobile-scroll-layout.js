#!/usr/bin/env node
'use strict';

/**
 * Guards for unlocked mobile / Android document-scroll layout.
 * Run: node backend/scripts/test-mobile-scroll-layout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Global root scroll defaults ==');
const css = read('backend/public/styles.css');
// Default html/body must use natural height + overflow-y auto (not locked).
assert.ok(/html\s*\{[^}]*height:\s*auto/s.test(css), 'html height auto');
assert.ok(/html\s*\{[^}]*min-height:\s*100vh/s.test(css), 'html min-height 100vh');
assert.ok(/html\s*\{[^}]*overflow-y:\s*auto/s.test(css), 'html overflow-y auto');
assert.ok(/body\s*\{[^}]*height:\s*auto/s.test(css), 'body height auto');
assert.ok(/body\s*\{[^}]*min-height:\s*100vh/s.test(css), 'body min-height 100vh');
assert.ok(/body\s*\{[^}]*overflow-y:\s*auto/s.test(css), 'body overflow-y auto');
assert.ok(/body\s*\{[^}]*position:\s*relative/s.test(css), 'body not fixed by default');
assert.ok(css.includes('@media (min-width: 901px)'), 'desktop fixed shell media query');
assert.ok(css.includes('html.doc-scroll'), 'doc-scroll unlock class');
assert.ok(
  /#dashboardScreen\s*\{[^}]*overflow:\s*visible/s.test(css),
  'dashboardScreen overflow visible by default'
);
assert.ok(
  /\.app-shell\s*\{[^}]*overflow:\s*visible/s.test(css),
  'app-shell overflow visible by default'
);
assert.ok(
  /html\.doc-scroll body\.sidebar-scroll-lock\s*\{[^}]*overflow-y:\s*auto\s*!important/s.test(css),
  'doc-scroll keeps overflow-y auto under sidebar lock'
);
console.log('ok');

console.log('\n== Viewport + critical CSS ==');
const html = read('backend/public/index.html');
assert.ok(/name="viewport"[^>]*width=device-width/i.test(html), 'viewport meta');
assert.ok(html.includes('eisy-mobile-scroll-critical'), 'critical mobile scroll CSS');
assert.ok(html.includes('styles.css?v=20260908androidParity'), 'cache-busted styles');
assert.ok(html.includes('viewport.js?v=20260908androidParity'), 'cache-busted viewport.js');
assert.ok(html.includes("classList.add('doc-scroll')") || html.includes('classList.add("doc-scroll")'),
  'early Android/doc-scroll bootstrap');
const vp = read('backend/public/viewport.js');
assert.ok(vp.includes('doc-scroll'), 'viewport.js toggles doc-scroll');
assert.ok(vp.includes('isAndroid') || vp.includes('Android'), 'Android detection');
console.log('ok');

console.log('\n== Android/iOS layout parity ==');
assert.ok(/\.auth-screen\s*\{[^}]*position:\s*relative/s.test(css), 'auth-screen relative');
assert.ok(/\.auth-screen\s*\{[^}]*height:\s*auto/s.test(css), 'auth-screen height auto (not h-screen)');
assert.ok(/\.auth-screen\s*\{[^}]*overflow:\s*visible/s.test(css), 'auth-screen overflow visible');
assert.ok(/\.header\s*\{[^}]*position:\s*relative/s.test(css), 'header relative by default');
assert.ok(
  /html\.doc-scroll \.header[\s\S]*?position:\s*relative\s*!important/m.test(css),
  'doc-scroll header stays relative (no sticky overlap)'
);
assert.ok(!/--sidebar-safe-top:\s*max\(3rem/.test(css), 'no aggressive 3rem safe-top floor');
console.log('ok');

console.log('\n== Android WebView injection ==');
const main = read('android/app/src/main/java/com/eisymyanmar/app/MainActivity.java');
assert.ok(main.includes('doc-scroll'), 'adds doc-scroll in WebView');
assert.ok(main.includes('overflow-y:auto') || main.includes("overflow-y:auto!important"),
  'WebView injects overflow-y auto');
assert.ok(main.includes('min-height:100vh'), 'WebView injects min-height 100vh');
console.log('ok');

console.log('\nMobile scroll layout checks passed.');
