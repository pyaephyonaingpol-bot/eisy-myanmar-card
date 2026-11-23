#!/usr/bin/env node
/**
 * Technical SEO guards for eisymyanmar.com (Express SPA — not Next.js App Router).
 * Run: node backend/scripts/test-seo-visa-metadata.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const read = (rel) => fs.readFileSync(path.join(publicDir, rel), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Homepage metadata');
{
  const html = read('index.html');
  assert.ok(html.includes('<title>Eisy Myanmar | No KYC Virtual Visa Card Service</title>'));
  assert.ok(html.includes('Get instant No KYC virtual Visa cards in Myanmar and worldwide'));
  assert.ok(html.includes('No KYC virtual card'));
  assert.ok(html.includes('Virtual Visa card Myanmar'));
  assert.ok(html.includes('USDT virtual Visa card'));
  assert.ok(html.includes('Crypto Visa card no verification'));
  assert.ok(html.includes('rel="canonical" href="https://eisymyanmar.com/"'));
  assert.ok(html.includes('property="og:title"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('"@type": "FinancialService"'));
  assert.ok(html.includes('"@type": "FAQPage"'));
  assert.ok(html.includes('<h1 class="auth-brand-title">No KYC Virtual Visa Card</h1>'));
  assert.ok(!/Mastercard/i.test(html), 'homepage must not mention Mastercard');
  console.log('ok');
}

section('robots.txt + sitemap.xml');
{
  const robots = read('robots.txt');
  assert.ok(robots.includes('Allow: /'));
  assert.ok(robots.includes('Disallow: /dashboard'));
  assert.ok(robots.includes('Disallow: /admin'));
  assert.ok(robots.includes('Disallow: /api/'));
  assert.ok(robots.includes('Disallow: /auth/'));
  assert.ok(robots.includes('Sitemap: https://eisymyanmar.com/sitemap.xml'));

  const sitemap = read('sitemap.xml');
  assert.ok(sitemap.startsWith('<?xml'), 'sitemap has XML declaration');
  assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(sitemap.includes('<url>'));
  assert.ok(sitemap.includes('<loc>https://eisymyanmar.com/</loc>'));
  assert.ok(sitemap.includes('<lastmod>'));
  assert.ok(sitemap.includes('<priority>1.0</priority>'));
  assert.ok(sitemap.includes('https://eisymyanmar.com/faq'));
  assert.ok(sitemap.includes('https://eisymyanmar.com/about'));
  assert.ok(sitemap.includes('<priority>0.8</priority>'));
  assert.ok(sitemap.includes('https://eisymyanmar.com/terms'));
  assert.ok(sitemap.includes('<priority>0.3</priority>'));
  assert.ok(sitemap.includes('</urlset>'));

  const { buildSitemapXml } = require(path.join(root, 'src/lib/sitemapXml'));
  const dynamicXml = buildSitemapXml();
  assert.ok(dynamicXml.includes('<urlset'));
  assert.ok(dynamicXml.includes('<lastmod>'));
  assert.ok(dynamicXml.includes('<loc>https://eisymyanmar.com/blog</loc>'));
  assert.ok(dynamicXml.includes('xml-stylesheet'), 'sitemap references display stylesheet');
  assert.ok(
    /application\/xml/.test(
      fs.readFileSync(path.join(root, 'src/index.js'), 'utf8')
    ),
    'Express sets application/xml for sitemap'
  );
  const vercel = fs.readFileSync(path.join(root, '..', 'vercel.json'), 'utf8');
  assert.ok(vercel.includes('"/api/sitemap"'), 'vercel rewrites sitemap to dedicated function');
  assert.ok(vercel.includes('max-age=0'), 'vercel sitemap headers use max-age=0');
  assert.ok(
    vercel.includes('(?!sitemap') || vercel.includes('(?!sitemap(?:/)?$'),
    'vercel excludes /api/sitemap from Express catch-all rewrite'
  );
  assert.ok(fs.existsSync(path.join(root, '..', 'api', 'sitemap.js')), 'api/sitemap.js exists');
  assert.ok(fs.existsSync(path.join(root, 'public', 'sitemap.xsl')), 'sitemap.xsl exists for browser display');
  const pkg = fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8');
  assert.ok(pkg.includes('rm -f public/sitemap.xml'), 'vercel-build strips static sitemap.xml');
  console.log('ok');
}

section('FAQ page + Express routes');
{
  const faq = read('faq.html');
  assert.ok(faq.includes('<h1>No KYC Virtual Visa Card FAQ</h1>'));
  assert.ok(faq.includes('"@type": "FAQPage"'));
  assert.ok(faq.includes('canonical" href="https://eisymyanmar.com/faq"'));
  assert.ok(faq.includes('Visa only'), 'FAQ states Visa only');

  const server = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  assert.ok(server.includes("'/faq'") || server.includes('/faq'), 'Express serves /faq');
  assert.ok(server.includes('/robots.txt'));
  assert.ok(server.includes('/sitemap.xml'));
  assert.ok(
    !/html\.replace\(\s*\/<title>\[\^<\]\*<\/title>\/i\s*,\s*'<title>Eisymyanmar<\/title>'/.test(server),
    'portal sender no longer clobbers SEO title'
  );
  console.log('ok');
}

section('Portal generation preserves SEO title');
{
  const portalScript = fs.readFileSync(path.join(root, 'scripts/write-portal-html.js'), 'utf8');
  assert.ok(!portalScript.includes("<title>Eisymyanmar</title>"), 'write-portal-html keeps SEO title');
  const instant = read('instant.html');
  assert.ok(instant.includes('<title>Eisy Myanmar | No KYC Virtual Visa Card Service</title>'));
  assert.ok(instant.includes('FinancialService'));
  console.log('ok');
}

section('Admin is noindex; legal pages have canonical');
{
  const admin = read('admin.html');
  assert.ok(admin.includes('noindex, nofollow'));
  for (const page of ['about.html', 'terms.html', 'privacy.html', 'refund.html']) {
    const html = read(page);
    assert.ok(html.includes('rel="canonical"'), `${page} has canonical`);
    assert.ok(!/Visa\/Mastercard/i.test(html), `${page} has no Visa/Mastercard pairing`);
  }
  console.log('ok');
}

console.log('\nSEO Visa metadata checks passed.');
