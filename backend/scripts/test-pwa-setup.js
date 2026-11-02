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

const i18nSrc = fs.readFileSync(path.join(PUBLIC, 'i18n.js'), 'utf8');
assert.ok(i18nSrc.includes("pwa_install_app_btn: 'Install App'"), 'i18n defines Install App label');
assert.ok(i18nSrc.includes('pwa_install_ios_modal_title'), 'i18n defines iOS install modal copy');

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
  assert.ok(page.includes('id="pwaInstallBanner"'), `${name} install banner shell`);
  assert.ok(page.includes('id="pwaInstallBtn"'), `${name} install button`);
  assert.ok(page.includes('js-pwa-install-app'), `${name} persistent Install App control`);
  assert.ok(page.includes('id="pwaInstallAppHeader"'), `${name} header Install App button`);
  assert.ok(page.includes('id="pwaIosInstallModal"'), `${name} iOS install instructions modal`);
}

const pwa = read('pwa.js');
assert.ok(pwa.includes('registerServiceWorker'), 'pwa.js registers worker');
assert.ok(pwa.includes('EisyPwa'), 'pwa.js exposes EisyPwa');
assert.ok(pwa.includes('beforeinstallprompt'), 'pwa.js listens for beforeinstallprompt');
assert.ok(pwa.includes('promptInstall'), 'pwa.js exposes install prompt handler');
assert.ok(pwa.includes('.prompt()'), 'pwa.js calls native install prompt');
assert.ok(pwa.includes('js-pwa-install-app'), 'pwa.js binds persistent Install App buttons');
assert.ok(pwa.includes('refreshInstallAppButtons'), 'pwa.js toggles Install App visibility');
assert.ok(pwa.includes('openIosInstallModal'), 'pwa.js shows iOS install instructions modal');
assert.ok(pwa.includes('applyInstallButtonLabels'), 'pwa.js applies Install App button labels');

const sw = read('sw.js');
assert.ok(sw.includes('PWA_CACHE'), 'service worker defines PWA cache');
assert.ok(sw.includes("addEventListener('fetch'"), 'service worker handles fetch for installability');
assert.ok(sw.includes("addEventListener('push'"), 'service worker still handles push');

const push = read('pushNotifications.js');
assert.ok(push.includes('EisyPwa?.registerServiceWorker'), 'push reuses PWA registration');

console.log('test-pwa-setup: OK');
