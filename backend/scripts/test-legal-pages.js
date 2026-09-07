#!/usr/bin/env node
'use strict';

/**
 * Legal & compliance pages + footer links.
 * Run: node backend/scripts/test-legal-pages.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'backend/public');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

section('Legal HTML pages exist with required content');
for (const file of ['terms.html', 'privacy.html', 'refund.html', 'legal.css']) {
  assert.ok(fs.existsSync(path.join(PUBLIC, file)), `${file} missing`);
}

const terms = read('backend/public/terms.html');
const privacy = read('backend/public/privacy.html');
const refund = read('backend/public/refund.html');
const indexHtml = read('backend/public/index.html');
const styles = read('backend/public/styles.css');
const server = read('backend/src/index.js');

assert.ok(terms.includes('Terms of Service') || terms.includes('Terms and Conditions'), 'terms title');
assert.ok(terms.includes('Stripe Issuing'), 'terms mentions Stripe Issuing');
assert.ok(terms.includes('P2P'), 'terms mentions P2P');
assert.ok(terms.includes('[Company Name]'), 'terms company placeholder');
assert.ok(terms.includes('[Registered Address]'), 'terms address placeholder');
assert.ok(terms.includes('support@eisymyanmar.com'), 'terms support email');

assert.ok(privacy.includes('Privacy Policy'), 'privacy title');
assert.ok(privacy.includes('Myanmar passport'), 'privacy covers passport KYC');
assert.ok(privacy.includes('data security') || privacy.includes('Data security'), 'privacy security section');
assert.ok(privacy.includes('support@eisymyanmar.com'), 'privacy support email');

assert.ok(refund.includes('Refund'), 'refund title');
assert.ok(refund.includes('top-up') || refund.includes('reload'), 'refund covers card top-ups');
assert.ok(refund.includes('P2P'), 'refund covers P2P');
assert.ok(refund.includes('support@eisymyanmar.com'), 'refund support email');

section('Express routes for /terms /privacy /refund');
assert.ok(server.includes("app.get('/privacy'"), 'privacy route');
assert.ok(server.includes("app.get('/refund'"), 'refund route');
assert.ok(server.includes('privacy.html'), 'privacy file served');
assert.ok(server.includes('refund.html'), 'refund file served');

section('Footer / auth legal links');
assert.ok(indexHtml.includes('href="/terms"'), 'footer terms link');
assert.ok(indexHtml.includes('href="/privacy"'), 'footer privacy link');
assert.ok(indexHtml.includes('href="/refund"'), 'footer refund link');
assert.ok(indexHtml.includes('legal-footer-links') || indexHtml.includes('auth-legal-links'), 'legal link containers');
assert.ok(styles.includes('.legal-footer-links'), 'footer link styles');
assert.ok(styles.includes('.auth-legal-links'), 'auth link styles');

console.log('\nAll legal pages checks passed.');
