#!/usr/bin/env node
'use strict';

/**
 * Content-hash cache bust for admin shell (admin.html → admin-instant.html).
 * Prevents stale admin.js after UI changes (e.g. Netts auto-sweep buttons).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const ADMIN_HTML = path.join(PUBLIC, 'admin.html');
const RELEASE = '20261023nettsSweep';

const ASSETS = ['admin.js', 'adminUserDetail.js'];

function hashFile(rel) {
  const abs = path.join(PUBLIC, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`[stamp-admin-cache] missing ${rel}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
}

function stampAsset(html, fileName, version) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped}\\?v=)[^"'\\s>]+`, 'g');
  if (!re.test(html)) {
    console.warn(`[stamp-admin-cache] no ?v= for ${fileName} in admin.html`);
    return html;
  }
  return html.replace(re, `$1${version}`);
}

function upsertMeta(html) {
  const meta = `<meta name="eisy-admin-assets" content="${RELEASE}" />`;
  if (/name="eisy-admin-assets"/.test(html)) {
    return html.replace(/<meta name="eisy-admin-assets" content="[^"]*" \/>/, meta);
  }
  return html.replace(/<head([^>])*>/i, (m) => `${m}\n  ${meta}`);
}

function main() {
  if (!fs.existsSync(ADMIN_HTML)) {
    throw new Error(`Missing ${ADMIN_HTML}`);
  }
  let html = fs.readFileSync(ADMIN_HTML, 'utf8');
  const versions = {};
  for (const rel of ASSETS) {
    const v = `${RELEASE}-${hashFile(rel)}`;
    versions[rel] = v;
    html = stampAsset(html, rel, v);
  }
  html = upsertMeta(html);
  fs.writeFileSync(ADMIN_HTML, html);
  console.log('[stamp-admin-cache] stamped admin.html', versions);
}

main();
