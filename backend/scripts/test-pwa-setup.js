#!/usr/bin/env node
'use strict';

/**
 * PWA manifest, meta tags, service worker, and bootstrap script.
 * Run: node backend/scripts/test-pwa-setup.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../public');
const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');

const manifest = JSON.parse(read('manifest.webmanifest'));
const manifestJson = JSON.parse(read('manifest.json'));

assert.strictEqual(manifest.name, 'Eisy Myanmar');
assert.strictEqual(manifest.short_name, 'Eisy');
assert.strictEqual(manifest.theme_color, '#0F172A');
assert.ok(manifest.icons.some((i) => i.src === '/icons/Icon-192.png'));
assert.ok(manifest.icons.some((i) => i.src === '/icons/Icon-512.png'));
assert.deepStrictEqual(manifestJson, manifest);

for (const name of ['index.html', 'instant.html']) {
  const page = read(name);
  assert.ok(page.includes('rel="manifest"'), `${name} links manifest`);
  assert.ok(page.includes('/manifest.webmanifest'), `${name} webmanifest href`);
  assert.ok(page.includes('/manifest.json'), `${name} manifest.json href`);
  assert.ok(page.includes('name="theme-color"'), `${name} theme-color meta`);
  assert.ok(page.includes('apple-mobile-web-app-capable'), `${name} iOS standalone meta`);
  assert.ok(page.includes('/icons/Icon-192.png'), `${name} apple-touch icon`);
  assert.ok(page.includes('/pwa.js'), `${name} PWA bootstrap script`);
}

const sw = read('sw.js');
assert.ok(sw.includes('PWA_CACHE'), 'service worker defines PWA cache');
assert.ok(sw.includes("addEventListener('fetch'"), 'service worker handles fetch for installability');
assert.ok(sw.includes("addEventListener('push'"), 'service worker still handles push');

const pwa = read('pwa.js');
assert.ok(pwa.includes('registerServiceWorker'), 'pwa.js registers worker');
assert.ok(pwa.includes('EisyPwa'), 'pwa.js exposes EisyPwa');

const push = read('pushNotifications.js');
assert.ok(push.includes('EisyPwa?.registerServiceWorker'), 'push reuses PWA registration');

console.log('test-pwa-setup: OK');
