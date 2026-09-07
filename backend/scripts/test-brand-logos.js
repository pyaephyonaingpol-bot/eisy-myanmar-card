#!/usr/bin/env node
'use strict';

/**
 * Brand logo assets + placement guards.
 * Run: node backend/scripts/test-brand-logos.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'backend/public');

function exists(rel) {
  return fs.existsSync(path.join(PUBLIC, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
}

console.log('== Brand logo files ==');
for (const rel of [
  'brand/logo-icon.png',
  'brand/logo-icon-badge.png',
  'brand/logo-full.png',
  'brand/logo-full-badge.png',
  'favicon.png',
  'favicon.ico',
  'apple-touch-icon.png',
  'icons/Icon-192.png',
  'icons/Icon-512.png',
]) {
  assert.ok(exists(rel), `missing ${rel}`);
  assert.ok(fs.statSync(path.join(PUBLIC, rel)).size > 200, `${rel} too small`);
}
console.log('ok');

console.log('\n== HTML wiring ==');
const html = read('index.html');
assert.ok(html.includes('/brand/logo-icon-badge.png'), 'auth/mobile icon badge');
assert.ok(html.includes('/brand/logo-full.png'), 'desktop full logo');
assert.ok(html.includes('auth-brand-logo'), 'auth brand class');
assert.ok(html.includes('header-logo-mobile'), 'mobile header logo');
assert.ok(html.includes('footer-brand-logo'), 'footer full logo');
assert.ok(html.includes('brand-link-sidebar'), 'sidebar brand link');
assert.ok(html.includes('favicon.png'), 'favicon link');
assert.ok(html.includes('apple-touch-icon.png'), 'apple touch icon');
console.log('ok');

console.log('\n== CSS responsive rules ==');
const css = read('styles.css');
assert.ok(css.includes('.auth-brand-logo'), 'auth logo style');
assert.ok(css.includes('.brand-logo-full'), 'full logo style');
assert.ok(css.includes('.header-logo-mobile'), 'mobile header style');
assert.ok(css.includes('.footer-brand-logo'), 'footer logo style');
assert.ok(/\.header-logo-mobile\s*\{[^}]*display:\s*inline-flex/s.test(css), 'mobile logo shown under breakpoint');
console.log('ok');

console.log('\nBrand logo checks passed.');
