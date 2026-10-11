#!/usr/bin/env node
'use strict';

/**
 * Apply content-hash cache bust (?v=release-hash) to portal shell assets in index.html.
 * Run before write-portal-html.js so instant.html inherits the same query strings.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('./portal-asset-manifest');

const PUBLIC = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUBLIC, 'index.html');
const VERSION_JSON = path.join(PUBLIC, 'asset-version.json');

function hashFile(relPath) {
  const abs = path.join(PUBLIC, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[stamp-portal-cache] missing asset: ${relPath}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
}

function versionFor(relPath) {
  return `${manifest.release}-${hashFile(relPath)}`;
}

function stampHtml(html, urlPath, version) {
  if (!html.includes(`${urlPath}?v=`)) {
    console.warn(`[stamp-portal-cache] no ?v= reference for ${urlPath} in index.html (skipped)`);
    return html;
  }
  const escaped = urlPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped}\\?v=)[^"'\\s>]+`, 'g');
  return html.replace(re, `$1${version}`);
}

function upsertMeta(html, release) {
  const meta = `<meta name="eisy-portal-assets" content="${release}" />`;
  if (/name="eisy-portal-assets"/.test(html)) {
    return html.replace(/<meta name="eisy-portal-assets" content="[^"]*" \/>/, meta);
  }
  return html.replace(/<head([^>]*)>/i, (m) => `${m}\n  ${meta}`);
}

function main() {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`Missing ${INDEX}`);
  }

  const versions = {};
  let html = fs.readFileSync(INDEX, 'utf8');

  for (const rel of manifest.assets) {
    const urlPath = `/${rel.replace(/^\//, '')}`;
    const v = versionFor(rel);
    versions[urlPath] = v;
    html = stampHtml(html, urlPath, v);
  }

  html = upsertMeta(html, manifest.release);
  fs.writeFileSync(INDEX, html);

  const payload = {
    release: manifest.release,
    generatedAt: new Date().toISOString(),
    assets: versions,
  };
  fs.writeFileSync(VERSION_JSON, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`[stamp-portal-cache] stamped ${manifest.assets.length} assets (release=${manifest.release})`);
  console.log(`[stamp-portal-cache] wrote ${VERSION_JSON}`);
}

main();
