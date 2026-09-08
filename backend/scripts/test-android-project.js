#!/usr/bin/env node
'use strict';

/**
 * Guards for the unified android/ WebView project.
 * Run: node backend/scripts/test-android-project.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Android project layout ==');
for (const rel of [
  'android/settings.gradle',
  'android/build.gradle',
  'android/app/build.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/java/com/eisymyanmar/app/MainActivity.java',
  'android/app/src/main/res/values/themes.xml',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  'scripts/build-android-apk.sh',
]) {
  assert.ok(exists(rel), `missing ${rel}`);
}
console.log('ok');

console.log('\n== Branding + no action bar ==');
const themes = read('android/app/src/main/res/values/themes.xml');
assert.ok(themes.includes('NoActionBar'), 'NoActionBar theme');
assert.ok(themes.includes('windowActionBar">false'), 'action bar disabled');
const manifest = read('android/app/src/main/AndroidManifest.xml');
assert.ok(manifest.includes('@mipmap/ic_launcher'), 'launcher icon');
assert.ok(manifest.includes('Theme.EisyMyanmar'), 'app theme');
const gradle = read('android/app/build.gradle');
assert.ok(gradle.includes("applicationId 'com.eisymyanmar.app'"), 'applicationId');
assert.ok(gradle.includes('WEB_APP_URL'), 'configurable web URL');
const main = read('android/app/src/main/java/com/eisymyanmar/app/MainActivity.java');
assert.ok(main.includes('getSupportActionBar()'), 'hides action bar at runtime');
assert.ok(main.includes('WebView'), 'WebView shell');
assert.ok(main.includes('setVerticalScrollBarEnabled(true)'), 'vertical scrollbars enabled');
assert.ok(main.includes('setFillViewport(true)'), 'ScrollView fillViewport enabled in code');
assert.ok(main.includes('setUseWideViewPort(true)'), 'wide viewport for proper scaling');
assert.ok(main.includes('setDecorFitsSystemWindows(getWindow(), true)')
  || main.includes('setDecorFitsSystemWindows(getWindow(),true)'),
  'decor fits system windows for correct viewport height');
assert.ok(main.includes('eisy-webview-scroll-fix'), 'injects WebView scroll CSS');
assert.ok(main.includes('.app-shell'), 'unlocks app-shell overflow in WebView');
assert.ok(main.includes('ScrollView'), 'uses ScrollView wrapper');
assert.ok(exists('android/app/src/main/java/com/eisymyanmar/app/ContentHeightWebView.java'),
  'ContentHeightWebView for ScrollView measure');
const layout = read('android/app/src/main/res/layout/activity_main.xml');
assert.ok(layout.includes('<ScrollView'), 'layout wraps WebView in ScrollView');
assert.ok(layout.includes('android:fillViewport="true"'), 'ScrollView fillViewport');
assert.ok(layout.includes('android:scrollbars="vertical"'), 'layout vertical scrollbars');
assert.ok(layout.includes('android:fitsSystemWindows="true"'), 'root fits system windows');
assert.ok(layout.includes('android:layout_width="match_parent"'), 'match_parent width');
assert.ok(layout.includes('ContentHeightWebView'), 'custom WebView in layout');
console.log('ok');

console.log('\n== Build wiring ==');
const pkg = read('package.json');
assert.ok(pkg.includes('android:apk'), 'npm android:apk script');
assert.ok(exists('scripts/build-android-apk.sh'), 'build script');
console.log('ok');

console.log('\nAndroid project checks passed.');
