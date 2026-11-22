#!/usr/bin/env node
/**
 * Guard against browser-shipped hardcoded http:// URLs that cause mixed content
 * on https://eisymyanmar.com (My Cards / SPA / admin).
 *
 * Run: node backend/scripts/test-mixed-content-http.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const BROWSER_GLOBS = [
  'index.html',
  'instant.html',
  'admin.html',
  'admin-instant.html',
  'about.html',
  'privacy.html',
  'terms.html',
  'refund.html',
  'styles.css',
  'legal.css',
  'android-scroll-fix.css',
  'api-config.js',
  'dashboard.js',
  'admin.js',
  'auth.js',
  'errorMonitor.js',
  'contactInfo.js',
  'i18n.js',
  'nav.js',
  'pwa.js',
  'manifest.json',
  'manifest.webmanifest',
  'src/lib/config.js',
  'src/lib/apiConfig.js',
];

function collectHttpOccurrences(filePath, text) {
  const hits = [];
  const re = /http:\/\//gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineEnd = text.indexOf('\n', m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    // Android XML xmlns is not mixed content.
    if (/xmlns:android=/i.test(line)) continue;
    if (/schemas\.android\.com/i.test(line)) continue;
    // Code comments still ship to browsers — still flag them; rewrite comments instead.
    hits.push({ index: m.index, line });
  }
  return hits;
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

function testPublicAssetsHaveNoHttp() {
  section('Browser public assets must not ship hardcoded http://');
  const offenders = [];
  for (const rel of BROWSER_GLOBS) {
    const full = path.join(publicDir, rel);
    if (!fs.existsSync(full)) {
      console.warn('skip missing', rel);
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    const hits = collectHttpOccurrences(full, text);
    for (const hit of hits) {
      offenders.push(`${rel}: ${hit.line.slice(0, 160)}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `Found hardcoded http:// in browser assets:\n${offenders.join('\n')}`
  );
  console.log('ok — no http:// in scanned public assets');
}

function testPreferHttpsHelpers() {
  section('preferHttpsMediaUrl helpers present');
  const dash = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');
  const admin = fs.readFileSync(path.join(publicDir, 'admin.js'), 'utf8');
  assert.ok(dash.includes('preferHttpsMediaUrl'), 'dashboard has preferHttpsMediaUrl');
  assert.ok(admin.includes('preferHttpsMediaUrl'), 'admin has preferHttpsMediaUrl');
  assert.ok(admin.includes('normalizeKycDocumentUrl'), 'admin normalizes KYC URLs');
  console.log('ok');
}

function testPagoPanHttpsOnly() {
  section('Pago PAN iframe rejects non-https');
  const { readCardPanUrlFromSources } = require('../src/services/pagoPanView');
  assert.strictEqual(readCardPanUrlFromSources({ card_pan_url: 'http://insecure.example/pan' }), null);
  assert.ok(
    String(readCardPanUrlFromSources({ card_pan_url: 'https://cards.cardapi.vip/display/x' }) || '')
      .startsWith('https://')
  );
  const dash = fs.readFileSync(path.join(publicDir, 'dashboard.js'), 'utf8');
  assert.ok(dash.includes("if (!s.startsWith('https://')) return false"), 'isTrustedPagoPanUrl requires https');
  console.log('ok');
}

function testUpgradeInsecureRequestsHeader() {
  section('Helmet emits upgrade-insecure-requests');
  const secSrc = fs.readFileSync(path.join(root, 'src/middleware/security.js'), 'utf8');
  assert.ok(secSrc.includes('upgradeInsecureRequests'), 'security middleware sets upgradeInsecureRequests');
  assert.ok(!secSrc.includes('contentSecurityPolicy: false'), 'CSP not fully disabled');
  console.log('ok');
}

function testConfigNoEmulatorHttp() {
  section('Config no longer ships LOCAL_ANDROID_EMULATOR http://');
  const cfg = fs.readFileSync(path.join(publicDir, 'src/lib/config.js'), 'utf8');
  const api = fs.readFileSync(path.join(publicDir, 'api-config.js'), 'utf8');
  assert.ok(!cfg.includes('LOCAL_ANDROID_EMULATOR'), 'config.js dropped unused emulator http constant');
  assert.ok(!api.includes('LOCAL_ANDROID_EMULATOR'), 'api-config.js dropped unused emulator http constant');
  assert.ok(!cfg.includes('http://'), 'config.js has no http://');
  assert.ok(!api.includes('http://'), 'api-config.js has no http://');
  assert.ok(cfg.includes("PRODUCTION_API: 'https://eisymyanmar.com'"));
  console.log('ok');
}

function main() {
  testPublicAssetsHaveNoHttp();
  testPreferHttpsHelpers();
  testPagoPanHttpsOnly();
  testUpgradeInsecureRequestsHeader();
  testConfigNoEmulatorHttp();
  console.log('\nAll mixed-content checks passed.');
}

main();
