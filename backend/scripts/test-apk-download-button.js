#!/usr/bin/env node
'use strict';

/**
 * Auth screen must not advertise APK download (PWA / Add to Home Screen only).
 * Run: node backend/scripts/test-apk-download-button.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../public');
const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');

for (const name of ['index.html', 'instant.html']) {
  const html = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
  assert.ok(!html.includes('Download App (APK)'), `${name}: APK label removed`);
  assert.ok(!html.includes('auth-apk-download'), `${name}: APK wrapper removed`);
  assert.ok(!html.includes('apk-download-btn'), `${name}: APK button removed`);
  assert.ok(!html.includes('/downloads/eisy-myanmar.apk'), `${name}: APK href removed`);
}

assert.ok(!css.includes('.apk-download-btn'), 'APK button styles removed');
assert.ok(!css.includes('.auth-apk-download'), 'APK wrapper styles removed');

console.log('test-apk-download-button: OK (PWA-only auth, no APK CTA)');
