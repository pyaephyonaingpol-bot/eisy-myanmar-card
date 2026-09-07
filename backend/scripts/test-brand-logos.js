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
assert.ok(html.includes('/brand/logo-icon.png'), 'transparent icon used in UI');
assert.ok(html.includes('/brand/logo-full.png'), 'desktop full logo');
assert.ok(html.includes('auth-brand-logo'), 'auth brand class');
assert.ok(html.includes('header-logo-mobile'), 'mobile header logo');
assert.ok(html.includes('brand-link-sidebar'), 'sidebar brand link');
assert.ok(html.includes('favicon.png'), 'favicon link');
assert.ok(html.includes('apple-touch-icon.png'), 'apple touch icon');
// No duplicate footer logo; sidebar keeps a single full lockup
assert.ok(!html.includes('footer-brand-logo'), 'footer logo duplicate removed');
const sidebarBrand = html.match(/class="sidebar-brand"[\s\S]*?<\/div>/);
assert.ok(sidebarBrand, 'sidebar-brand block present');
assert.ok(sidebarBrand[0].includes('brand-logo-full'), 'sidebar uses full logo');
assert.ok(!sidebarBrand[0].includes('brand-logo-icon'), 'no icon nested in sidebar brand');
assert.ok((sidebarBrand[0].match(/<img\b/g) || []).length === 1, 'exactly one logo in sidebar brand');
// Auth + mobile + splash use transparent icon (not white-badge plate)
const iconUses = (html.match(/\/brand\/logo-icon\.png/g) || []).length;
assert.ok(iconUses >= 3, `expected >=3 transparent icon refs, got ${iconUses}`);
console.log('ok');

console.log('\n== CSS responsive rules ==');
const css = read('styles.css');
assert.ok(css.includes('.auth-brand-logo'), 'auth logo style');
assert.ok(css.includes('.brand-logo-full'), 'full logo style');
assert.ok(css.includes('.header-logo-mobile'), 'mobile header style');
assert.ok(/\.header-logo-mobile\s*\{[^}]*display:\s*inline-flex/s.test(css), 'mobile logo shown under breakpoint');
assert.ok(/\.brand-logo-full\s*\{[^}]*max-height:\s*2\.5rem/s.test(css), 'full logo max-height ~40px');
assert.ok(/\.brand-logo-icon\s*\{[^}]*max-height:\s*2rem/s.test(css), 'icon max-height ~32px');
assert.ok(/object-fit:\s*contain/.test(css), 'object-fit contain');
// No white plate box on full logo
const fullBlock = css.match(/\.brand-logo-full\s*\{[^}]+\}/);
assert.ok(fullBlock, 'brand-logo-full block present');
assert.ok(!/background:\s*#fff/i.test(fullBlock[0]), 'full logo must not use white background box');
assert.ok(!/footer-brand-logo/.test(css), 'footer logo styles removed');
console.log('ok');

console.log('\nBrand logo checks passed.');
