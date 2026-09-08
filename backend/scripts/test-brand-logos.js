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
assert.ok(html.includes('auth-brand-logo'), 'auth brand class');
assert.ok(html.includes('header-logo-mobile'), 'mobile header logo');
assert.ok(html.includes('brand-link-sidebar'), 'sidebar brand link');
// Favicon / apple-touch must use the same file as the dashboard header icon
assert.ok(
  /rel=["']icon["'][^>]+href=["']\/brand\/logo-icon\.png/.test(html)
    || /href=["']\/brand\/logo-icon\.png[^"']*["'][^>]+rel=["']icon["']/.test(html),
  'favicon link points at /brand/logo-icon.png'
);
assert.ok(
  /rel=["']apple-touch-icon["'][^>]+href=["']\/brand\/logo-icon\.png/.test(html),
  'apple-touch-icon points at /brand/logo-icon.png'
);
assert.ok(!/rel=["']icon["'][^>]+href=["']\/favicon\.png/.test(html), 'legacy /favicon.png icon link removed');
assert.ok(!/rel=["']apple-touch-icon["'][^>]+href=["']\/apple-touch-icon\.png/.test(html), 'legacy apple-touch path removed');

const adminHtml = read('admin.html');
assert.ok(
  /rel=["']icon["'][^>]+href=["']\/brand\/logo-icon\.png/.test(adminHtml),
  'admin favicon uses logo-icon.png'
);
assert.ok(
  /rel=["']apple-touch-icon["'][^>]+href=["']\/brand\/logo-icon\.png/.test(adminHtml),
  'admin apple-touch uses logo-icon.png'
);

const manifest = read('manifest.webmanifest');
assert.ok(manifest.includes('/brand/logo-icon.png'), 'PWA manifest uses logo-icon.png');

// Fallback /favicon.png must be a byte-identical copy of the header icon
const iconBytes = fs.readFileSync(path.join(PUBLIC, 'brand/logo-icon.png'));
const faviconPng = fs.readFileSync(path.join(PUBLIC, 'favicon.png'));
assert.ok(Buffer.compare(iconBytes, faviconPng) === 0, 'favicon.png must match brand/logo-icon.png bytes');

// No duplicate footer logo; sidebar uses readable icon + text wordmark
assert.ok(!html.includes('footer-brand-logo'), 'footer logo duplicate removed');
const sidebarBrand = html.match(/class="sidebar-brand"[\s\S]*?<\/div>/);
assert.ok(sidebarBrand, 'sidebar-brand block present');
assert.ok(sidebarBrand[0].includes('brand-logo-sidebar'), 'sidebar uses sidebar icon mark');
assert.ok(sidebarBrand[0].includes('sidebar-brand-title'), 'sidebar has readable text title');
assert.ok(sidebarBrand[0].includes('Eisy Myanmar'), 'sidebar title text present');
assert.ok(!sidebarBrand[0].includes('brand-logo-full'), 'tiny full lockup removed from sidebar');
assert.ok(!sidebarBrand[0].includes('logo-full.png'), 'full logo image not used in sidebar');
assert.ok((sidebarBrand[0].match(/<img\b/g) || []).length === 1, 'exactly one logo image in sidebar brand');
// Auth + mobile + splash + favicon/apple + sidebar icon
const iconUses = (html.match(/\/brand\/logo-icon\.png/g) || []).length;
assert.ok(iconUses >= 7, `expected >=7 logo-icon refs (UI+favicon+sidebar), got ${iconUses}`);
console.log('ok');

console.log('\n== CSS responsive rules ==');
const css = read('styles.css');
assert.ok(css.includes('.auth-brand-logo'), 'auth logo style');
assert.ok(css.includes('.brand-logo-sidebar'), 'sidebar icon style');
assert.ok(css.includes('.sidebar-brand-title'), 'sidebar title style');
assert.ok(css.includes('.header-logo-mobile'), 'mobile header style');
assert.ok(/\.header-logo-mobile\s*\{[^}]*display:\s*inline-flex/s.test(css), 'mobile logo shown under breakpoint');
assert.ok(/\.brand-logo-sidebar\s*\{[^}]*max-height:\s*2\.5rem/s.test(css), 'sidebar icon ~40px');
assert.ok(/\.brand-logo-icon\s*\{[^}]*max-height:\s*2rem/s.test(css), 'icon max-height ~32px');
assert.ok(/object-fit:\s*contain/.test(css), 'object-fit contain');
assert.ok(/\.brand-link\.header-logo-mobile\s*\{[^}]*display:\s*none/s.test(css), 'desktop hides mobile header logo');
assert.ok(/\.brand-link-sidebar\s*\{[^}]*gap:/s.test(css), 'sidebar brand has icon/text gap');
assert.ok(
  css.includes('.app-shell.sidebar-open .header-logo-mobile'),
  'open drawer hides mobile header logo to avoid duplicate'
);
assert.ok(!/footer-brand-logo/.test(css), 'footer logo styles removed');
assert.ok(!html.includes('<<<<<<<') && !html.includes('>>>>>>>'), 'index.html has no git conflict markers');
console.log('ok');

console.log('\nBrand logo checks passed.');
