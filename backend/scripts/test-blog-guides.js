#!/usr/bin/env node
/**
 * Blog / Guides SSG guards for eisymyanmar.com.
 * Run: node backend/scripts/test-blog-guides.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '../..');
const publicDir = path.join(root, 'backend/public');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Build blog pages');
execFileSync(process.execPath, [path.join(__dirname, 'build-blog-pages.js')], {
  cwd: root,
  stdio: 'inherit',
});

const { getAllPosts, getAllSlugs } = require(path.join(root, 'data/blogs.js'));
const posts = getAllPosts();
const slugs = getAllSlugs();

section('Three high-intent guides present');
assert.strictEqual(posts.length, 3);
assert.ok(slugs.includes('how-to-get-no-kyc-virtual-visa-card-with-usdt-2026'));
assert.ok(slugs.includes('myanmar-chatgpt-plus-facebook-ads-virtual-visa'));
assert.ok(slugs.includes('best-uses-crypto-virtual-visa-card-no-id-verification'));
for (const p of posts) {
  assert.ok(p.title && p.description && p.sections.length >= 3, `${p.slug} has content`);
  const blob = JSON.stringify(p);
  assert.ok(!/mastercard/i.test(blob), `${p.slug} must not mention Mastercard`);
}
console.log('ok');

section('Generated HTML + Article JSON-LD + CTA');
{
  const indexHtml = fs.readFileSync(path.join(publicDir, 'blog/index.html'), 'utf8');
  assert.ok(indexHtml.includes('<h1>Guides &amp; Blog</h1>') || indexHtml.includes('<h1>Guides & Blog</h1>'));
  assert.ok(indexHtml.includes('Get your No KYC Virtual Visa Card'));
  assert.ok(indexHtml.includes('rel="canonical" href="https://eisymyanmar.com/blog"'));

  for (const slug of slugs) {
    const html = fs.readFileSync(path.join(publicDir, 'blog', slug, 'index.html'), 'utf8');
    assert.ok(html.includes('"@type": "Article"'), `${slug} Article schema`);
    assert.ok(html.includes('Get your No KYC Virtual Visa Card'), `${slug} CTA`);
    assert.ok(html.includes(`canonical" href="https://eisymyanmar.com/blog/${slug}"`), `${slug} canonical`);
    assert.ok(html.includes('og:title'), `${slug} og tags`);
    assert.ok(!/mastercard/i.test(html), `${slug} html Visa-only`);
  }
  console.log('ok');
}

section('Sitemap includes /blog and all posts');
{
  const sitemap = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(sitemap.includes('<url>'));
  assert.ok(sitemap.includes('<loc>https://eisymyanmar.com/blog</loc>'));
  for (const slug of slugs) {
    assert.ok(
      sitemap.includes(`<loc>https://eisymyanmar.com/blog/${slug}</loc>`),
      `sitemap has ${slug}`
    );
  }
  assert.ok(sitemap.includes('</urlset>'));
  console.log('ok');
}

section('Express routes + nav links');
{
  const server = fs.readFileSync(path.join(root, 'backend/src/index.js'), 'utf8');
  assert.ok(server.includes("'/blog'") || server.includes('/blog'), 'Express /blog route');
  assert.ok(server.includes('/blog/:slug'), 'Express /blog/:slug route');

  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('href="/blog"'), 'app nav has Guides');

  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  assert.ok(robots.includes('Allow: /blog'));
  console.log('ok');
}

section('vercel-build includes blog SSG');
{
  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.ok(pkg.includes('build-blog-pages.js'), 'vercel-build runs blog SSG');
  console.log('ok');
}

console.log('\nBlog guides checks passed.');
