#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const manifest = require('./portal-asset-manifest');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const VERSION_JSON = path.join(ROOT, 'public', 'asset-version.json');

execFileSync(process.execPath, [path.join(__dirname, 'stamp-portal-cache.js')], { stdio: 'inherit' });

const html = fs.readFileSync(INDEX, 'utf8');
const versions = JSON.parse(fs.readFileSync(VERSION_JSON, 'utf8'));

assert.strictEqual(versions.release, manifest.release);
assert.ok(/name="eisy-portal-assets"/.test(html));

for (const rel of manifest.assets) {
  const urlPath = `/${rel.replace(/^\//, '')}`;
  const expected = versions.assets[urlPath];
  assert.ok(expected, `version entry for ${urlPath}`);
  assert.ok(
    html.includes(`${urlPath}?v=${expected}`),
    `index.html must reference ${urlPath}?v=${expected}`,
  );
  assert.match(expected, new RegExp(`^${manifest.release}-[a-f0-9]{10}$`));
}

console.log('[test-stamp-portal-cache] ok');
