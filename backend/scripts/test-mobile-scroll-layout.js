#!/usr/bin/env node
'use strict';

/**
 * Guards for Android / mobile document-scroll + smooth touch scrolling.
 * Single scrollport on html/body; wrappers overflow:visible; header relative;
 * -webkit-overflow-scrolling:touch + touch-action:pan-y on scroll wrappers.
 * Run: node backend/scripts/test-mobile-scroll-layout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Document-scroll root unlock ==');
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
assert.ok(/overflow-y:\s*auto\s*!important/.test(fix), 'fix sheet overflow-y auto on root');
assert.ok(/height:\s*auto\s*!important/.test(fix), 'fix sheet height auto');
assert.ok(/min-height:\s*100%\s*!important/.test(fix), 'fix sheet min-height 100%');
console.log('ok');

console.log('\n== Smooth touch scrolling ==');
assert.ok(/-webkit-overflow-scrolling:\s*touch/.test(css), 'styles use touch momentum scrolling');
assert.ok(/touch-action:\s*pan-y/.test(css), 'styles set touch-action pan-y');
assert.ok(/-webkit-overflow-scrolling:\s*touch\s*!important/.test(fix), 'fix sheet momentum scrolling');
assert.ok(/touch-action:\s*pan-y\s*!important/.test(fix), 'fix sheet touch-action pan-y');
assert.ok(/html\.is-scrolling/.test(fix), 'is-scrolling paint deferral present');
assert.ok(/backdrop-filter:\s*none\s*!important/.test(fix) && /html\.doc-scroll \.panel/.test(fix), 'panels drop blur on mobile');
const viewport = read('backend/public/viewport.js');
assert.ok(viewport.includes("passive: true"), 'viewport scroll/touch listeners are passive');
assert.ok(viewport.includes('is-scrolling'), 'viewport marks is-scrolling');
assert.ok(viewport.includes('EisyScroll'), 'EisyScroll helper exported');
assert.ok(viewport.includes("behavior: 'auto'"), 'keyboard scrollIntoView is not smooth (avoids jank)');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('EisyScroll?.isScrolling'), 'dashboard defers polls while scrolling');
console.log('ok');

console.log('\n== Single scrollport (no nested wrapper scroll) ==');
const strictIdx = css.lastIndexOf('STRICT Android / mobile document-scroll unlock');
assert.ok(strictIdx > 0, 'strict block locatable');
const strictTail = css.slice(strictIdx);
assert.ok(
  /html\.doc-scroll \.app-shell[\s\S]*?overflow:\s*visible\s*!important/.test(strictTail),
  'strict wrappers use overflow:visible'
);
assert.ok(
  !/#dashboardScreen[\s\S]{0,400}overflow-y:\s*auto\s*!important/.test(strictTail.split('html.doc-scroll,')[0]),
  'strict media wrappers must not set overflow-y:auto'
);
assert.ok(
  /html\.doc-scroll \.header[\s\S]*?position:\s*relative\s*!important/.test(css),
  'doc-scroll header is relative'
);
assert.ok(
  /html\.doc-scroll \.app-content\s*\{[^}]*padding-top:\s*1rem\s*!important/s.test(css),
  'app-content has padding-top under header'
);
assert.ok(/overflow:\s*visible\s*!important/.test(fix), 'fix sheet wrappers overflow visible');
assert.ok(/position:\s*relative\s*!important/.test(fix), 'fix sheet header relative');
assert.ok(/backdrop-filter:\s*none\s*!important/.test(fix), 'fix sheet kills header backdrop-filter');
assert.ok(/sidebar-toggle-fab/.test(fix), 'fix sheet hides sidebar FAB');
console.log('ok');

console.log('\n== HTML wiring ==');
const html = read('backend/public/index.html');
assert.ok(html.includes('android-scroll-fix.css'), 'loads android-scroll-fix.css');
assert.ok(html.includes('styles.css?v=20260909scrollSmooth'), 'cache-busted styles');
assert.ok(html.includes("classList.add('doc-scroll')"), 'early doc-scroll bootstrap');
assert.ok(html.includes("setProperty('overflow-y', 'auto', 'important')"), 'inline overflow-y unlock');
assert.ok(html.includes('touch-action: pan-y'), 'critical CSS touch-action pan-y');
assert.ok(html.includes('-webkit-overflow-scrolling: touch'), 'critical CSS momentum scrolling');
const admin = read('backend/public/admin.html');
assert.ok(admin.includes('styles.css?v=20260909scrollSmooth'), 'admin cache-busted styles');
console.log('ok');

console.log('\n== Android WebView injection ==');
const main = read('android/app/src/main/java/com/eisymyanmar/app/MainActivity.java');
assert.ok(main.includes('height:auto!important'), 'WebView height auto');
assert.ok(main.includes('min-height:100%!important'), 'WebView min-height 100%');
assert.ok(main.includes('overflow-y:auto!important'), 'WebView root overflow-y auto');
assert.ok(main.includes('overflow:visible!important'), 'WebView wrappers overflow visible');
assert.ok(main.includes('touch-action:pan-y!important'), 'WebView touch-action pan-y');
assert.ok(main.includes('-webkit-overflow-scrolling:touch!important'), 'WebView momentum scrolling');
assert.ok(main.includes('LAYER_TYPE_HARDWARE'), 'WebView hardware layer enabled');
assert.ok(main.includes('backdrop-filter:none!important'), 'WebView header unsticks backdrop');
assert.ok(main.includes('padding-top:1rem!important'), 'WebView content padding-top');
console.log('ok');

console.log('\nMobile scroll + smooth touch checks passed.');
