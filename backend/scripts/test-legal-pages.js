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
for (const file of ['terms.html', 'privacy.html', 'refund.html', 'about.html', 'legal.css']) {
  assert.ok(fs.existsSync(path.join(PUBLIC, file)), `${file} missing`);
}

const terms = read('backend/public/terms.html');
const privacy = read('backend/public/privacy.html');
const refund = read('backend/public/refund.html');
const about = read('backend/public/about.html');
const indexHtml = read('backend/public/index.html');
const styles = read('backend/public/styles.css');
const server = read('backend/src/index.js');

assert.ok(terms.includes('class="legal-doc"') || terms.includes("class='legal-doc'") || terms.includes('legal-doc'), 'terms legal-doc class');
assert.ok(privacy.includes('legal-doc'), 'privacy legal-doc class');
assert.ok(refund.includes('legal-doc'), 'refund legal-doc class');
assert.ok(about.includes('legal-doc'), 'about legal-doc class');

const legalCss = read('backend/public/legal.css');
assert.ok(legalCss.includes('html.legal-doc'), 'legal.css opts out of SPA shell');
assert.ok(/overflow-y:\s*auto/i.test(legalCss), 'legal.css enables vertical scroll');
assert.ok(/position:\s*static/i.test(legalCss), 'legal.css unsets fixed body');
assert.ok(legalCss.includes('.about-founder'), 'about founder styles');
assert.ok(legalCss.includes('.about-hero'), 'about hero styles');

assert.ok(terms.includes('Terms of Service') || terms.includes('Terms and Conditions'), 'terms title');
assert.ok(terms.includes('Stripe Issuing'), 'terms mentions Stripe Issuing');
assert.ok(terms.includes('P2P'), 'terms mentions P2P');
assert.ok(terms.includes('Company Name:</strong> Eisy Myanmar') || terms.includes('Company Name:</strong> Eisy Myanmar'), 'terms company name is Eisy Myanmar');
assert.ok(terms.includes('Eisy Myanmar'), 'terms uses Eisy Myanmar');
assert.ok(!terms.includes('[Company Name]'), 'terms has no company placeholder');
assert.ok(!terms.includes('[Registered Address]'), 'terms has no address placeholder');
assert.ok(!terms.includes('Registered Address'), 'terms omits registered address');
assert.ok(terms.includes('© 2026 Eisy Myanmar. All rights reserved.'), 'terms copyright');
assert.ok(terms.includes('support@eisymyanmar.com'), 'terms support email');
assert.ok(terms.includes('href="/about"'), 'terms nav links to about');

assert.ok(privacy.includes('Privacy Policy'), 'privacy title');
assert.ok(privacy.includes('Myanmar passport'), 'privacy covers passport KYC');
assert.ok(privacy.includes('data security') || privacy.includes('Data security'), 'privacy security section');
assert.ok(privacy.includes('Company Name:</strong> Eisy Myanmar') || privacy.includes('Eisy Myanmar'), 'privacy company name');
assert.ok(!privacy.includes('[Company Name]'), 'privacy has no company placeholder');
assert.ok(!privacy.includes('[Registered Address]'), 'privacy has no address placeholder');
assert.ok(!privacy.includes('Registered Address'), 'privacy omits registered address');
assert.ok(privacy.includes('© 2026 Eisy Myanmar. All rights reserved.'), 'privacy copyright');
assert.ok(privacy.includes('support@eisymyanmar.com'), 'privacy support email');
assert.ok(privacy.includes('href="/about"'), 'privacy nav links to about');

assert.ok(refund.includes('Refund'), 'refund title');
assert.ok(refund.includes('top-up') || refund.includes('reload'), 'refund covers card top-ups');
assert.ok(refund.includes('P2P'), 'refund covers P2P');
assert.ok(!refund.includes('[Company Name]'), 'refund has no company placeholder');
assert.ok(!refund.includes('[Registered Address]'), 'refund has no address placeholder');
assert.ok(!refund.includes('Registered Address'), 'refund omits registered address');
assert.ok(refund.includes('© 2026 Eisy Myanmar. All rights reserved.'), 'refund copyright');
assert.ok(refund.includes('support@eisymyanmar.com'), 'refund support email');
assert.ok(refund.includes('href="/about"'), 'refund nav links to about');

assert.ok(about.includes('About Eisy Myanmar'), 'about title');
assert.ok(about.includes('virtual card') || about.includes('virtual cards'), 'about covers virtual cards');
assert.ok(about.includes('USDT'), 'about covers USDT');
assert.ok(about.includes('P2P'), 'about covers P2P');
assert.ok(about.includes('Pyae Phyo Naing'), 'about names founder');
assert.ok(about.includes('Founder') || about.includes('founder'), 'about founder section');
assert.ok(/trust|security|accessible|accessibility/i.test(about), 'about emphasizes trust/security/access');
assert.ok(about.includes('support@eisymyanmar.com'), 'about support email');
assert.ok(about.includes('about-founder'), 'about founder markup class');
assert.ok(about.includes('© 2026 Eisy Myanmar. All rights reserved.'), 'about copyright');
assert.ok(!about.includes('[Registered Address]'), 'about has no address placeholder');
assert.ok(!about.includes('Registered Address'), 'about omits registered address');

section('Express routes for /terms /privacy /refund /about');
assert.ok(server.includes("app.get('/privacy'"), 'privacy route');
assert.ok(server.includes("app.get('/refund'"), 'refund route');
assert.ok(server.includes("app.get('/about'"), 'about route');
assert.ok(server.includes('privacy.html'), 'privacy file served');
assert.ok(server.includes('refund.html'), 'refund file served');
assert.ok(server.includes('about.html'), 'about file served');

section('Footer / auth legal links');
assert.ok(indexHtml.includes('href="/about"'), 'footer about link');
assert.ok(indexHtml.includes('href="/terms"'), 'footer terms link');
assert.ok(indexHtml.includes('href="/privacy"'), 'footer privacy link');
assert.ok(indexHtml.includes('href="/refund"'), 'footer refund link');
assert.ok(indexHtml.includes('legal-footer-links') || indexHtml.includes('auth-legal-links'), 'legal link containers');
assert.ok(indexHtml.includes('© 2026 Eisy Myanmar. All rights reserved.'), 'app footer copyright');
assert.ok(!indexHtml.includes('[Registered Address]'), 'app footer has no address placeholder');
assert.ok(!indexHtml.includes('[Company Name]'), 'app footer has no company placeholder');
assert.ok(styles.includes('.legal-footer-links'), 'footer link styles');
assert.ok(styles.includes('.legal-footer-copyright'), 'footer copyright styles');
assert.ok(styles.includes('.auth-legal-links'), 'auth link styles');
assert.ok(legalCss.includes('.legal-copyright'), 'legal copyright styles');
assert.ok(/\.auth-screen\s*\{[^}]*flex-direction:\s*column/s.test(styles), 'auth-screen stacks column');
// Policy links must sit inside the login card (below forms), not as a flex sibling beside it
const authScreenIdx = indexHtml.indexOf('id="authScreen"');
const legalNavIdx = indexHtml.indexOf('class="auth-legal-links"');
assert.ok(authScreenIdx >= 0 && legalNavIdx > authScreenIdx, 'auth legal nav present');
assert.ok(
  legalNavIdx < indexHtml.indexOf('<!-- ═══ PIN MODALS', authScreenIdx),
  'auth legal links remain in auth screen'
);
assert.ok(
  /auth-card[\s\S]*auth-legal-links[\s\S]*<\/div>\s*<\/div>/m.test(
    indexHtml.slice(authScreenIdx, indexHtml.indexOf('<!-- ═══ PIN MODALS', authScreenIdx))
  ),
  'auth-legal-links nested inside auth-card'
);
assert.ok(styles.includes('border-top:') && styles.includes('.auth-legal-links'), 'auth legal footer separator');

console.log('\nAll legal pages checks passed.');
