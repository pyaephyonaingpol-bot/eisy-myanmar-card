#!/usr/bin/env node
/**
 * SSG builder for /blog (Express SPA equivalent of Next.js
 * generateStaticParams + generateMetadata).
 *
 * Writes:
 *   backend/public/blog/index.html
 *   backend/public/blog/<slug>/index.html
 *   backend/public/sitemap.xml (includes blog URLs)
 *
 * Run: node backend/scripts/build-blog-pages.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const publicDir = path.join(root, 'backend/public');
const blogDir = path.join(publicDir, 'blog');
const {
  SITE_ORIGIN,
  getAllPosts,
  getAllSlugs,
} = require(path.join(root, 'data/blogs.js'));

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'ul' || b.type === 'ol') {
      const tag = b.type;
      const items = (b.items || []).map((it) => `<li>${esc(it)}</li>`).join('\n');
      return `<${tag}>\n${items}\n</${tag}>`;
    }
    if (b.type === 'note') {
      return `<p class="blog-note"><strong>Note:</strong> ${esc(b.text)}</p>`;
    }
    return `<p>${esc(b.text)}</p>`;
  }).join('\n');
}

function siteNav(active) {
  const links = [
    ['/', 'Home'],
    ['/blog', 'Guides'],
    ['/faq', 'FAQ'],
    ['/about', 'About'],
    ['/terms', 'Terms'],
    ['/privacy', 'Privacy'],
    ['/refund', 'Refunds'],
  ];
  return `<nav class="legal-nav" aria-label="Site">\n${links.map(([href, label]) => {
    const cur = active === href ? ' aria-current="page"' : '';
    return `      <a href="${href}"${cur}>${label}</a>`;
  }).join('\n')}\n    </nav>`;
}

function ctaBanner() {
  return `<aside class="blog-cta" aria-label="Get a No KYC Virtual Visa Card">
      <div class="blog-cta-copy">
        <h2 class="blog-cta-title">Get your No KYC Virtual Visa Card</h2>
        <p class="blog-cta-text">Open Eisy Myanmar, deposit USDT, and issue a Visa card for Facebook Ads, ChatGPT Plus, and online payments — without ID verification for card issuing.</p>
      </div>
      <a class="btn btn-primary blog-cta-btn" href="/">Get Virtual Visa Card</a>
    </aside>`;
}

function layoutHead({ title, description, keywords, canonical, locale, lang, ogType, jsonLd }) {
  const kw = (keywords || []).join(', ');
  return `<!DOCTYPE html>
<html lang="${esc(lang || 'en')}" class="legal-doc">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="keywords" content="${esc(kw)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="${esc(ogType || 'website')}" />
  <meta property="og:locale" content="${esc(locale || 'en_US')}" />
  <meta property="og:site_name" content="Eisy Myanmar" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${SITE_ORIGIN}/brand/logo-icon.png" />
  <meta property="og:image:alt" content="Eisy Myanmar No KYC Virtual Visa Card" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${SITE_ORIGIN}/brand/logo-icon.png" />
  <meta name="theme-color" content="#0F172A" />
  <link rel="icon" href="/brand/logo-icon.png?v=20260907favicon" type="image/png" sizes="any" />
  <link rel="apple-touch-icon" href="/brand/logo-icon.png?v=20260907favicon" />
  <link rel="stylesheet" href="/styles.css?v=20261123seoVisa" />
  <link rel="stylesheet" href="/legal.css?v=20261123blogGuides" />
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
</head>`;
}

function writeIndex(posts) {
  const canonical = `${SITE_ORIGIN}/blog`;
  const title = 'Guides — No KYC Virtual Visa Card | Eisy Myanmar';
  const description =
    'Practical guides on No KYC virtual Visa cards, buying with USDT, paying Facebook Ads and ChatGPT Plus from Myanmar, and crypto Visa spend without ID verification.';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'Eisy Myanmar', url: SITE_ORIGIN },
    about: 'No KYC Virtual Visa Card guides',
  };

  const cards = posts.map((p) => `<article class="blog-card">
        <p class="blog-card-meta">${esc(p.heroLabel)} · ${esc(p.publishedAt)} · ${p.readingMinutes} min</p>
        <h2 class="blog-card-title"><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
        <p class="blog-card-desc">${esc(p.description)}</p>
        <a class="blog-card-link" href="/blog/${esc(p.slug)}">Read guide →</a>
      </article>`).join('\n');

  const html = `${layoutHead({
    title,
    description,
    keywords: [
      'No KYC virtual Visa card',
      'Virtual Visa card Myanmar',
      'buy virtual Visa with USDT',
      'crypto Visa card no verification',
      'Eisy Myanmar guides',
    ],
    canonical,
    locale: 'en_US',
    lang: 'en',
    ogType: 'website',
    jsonLd,
  })}
<body class="legal-doc">
  <main class="legal-page blog-page">
    <a class="legal-back" href="/">&larr; Back to Eisy Myanmar</a>
    ${siteNav('/blog')}
    <header class="about-hero blog-hero">
      <img class="about-hero-logo" src="/brand/logo-icon.png" width="56" height="56" alt="Eisy Myanmar — No KYC Virtual Visa Card" />
      <div class="about-hero-copy">
        <h1>Guides &amp; Blog</h1>
        <p class="meta about-hero-meta">No KYC Virtual Visa Card · USDT · MMK · Myanmar &amp; worldwide</p>
      </div>
    </header>
    <p class="blog-intro">Actionable articles to get a Visa card, fund with USDT, and pay online — Visa only.</p>
    ${ctaBanner()}
    <div class="blog-grid">
${cards}
    </div>
    <p class="legal-footer-copyright">© 2026 Eisy Myanmar. All rights reserved.</p>
  </main>
</body>
</html>
`;

  fs.mkdirSync(blogDir, { recursive: true });
  fs.writeFileSync(path.join(blogDir, 'index.html'), html);
  console.log('[build-blog] wrote blog/index.html');
}

function writePost(post) {
  const canonical = `${SITE_ORIGIN}/blog/${post.slug}`;
  const title = `${post.title} | Eisy Myanmar`;
  const articleBody = post.sections.map((sec) => `
      <section class="blog-section" aria-labelledby="${esc(post.slug)}-${esc(sec.heading).slice(0, 24)}">
        <h2 id="${esc(post.slug)}-${esc(sec.heading).slice(0, 24)}">${esc(sec.heading)}</h2>
        ${renderBlocks(sec.blocks)}
      </section>`).join('\n');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    inLanguage: post.lang || 'en',
    author: { '@type': 'Organization', name: 'Eisy Myanmar', url: SITE_ORIGIN },
    publisher: {
      '@type': 'Organization',
      name: 'Eisy Myanmar',
      url: SITE_ORIGIN,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_ORIGIN}/brand/logo-icon.png`,
      },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    keywords: (post.keywords || []).join(', '),
    articleSection: 'Guides',
    about: [
      'No KYC virtual Visa card',
      'USDT virtual Visa card',
      'Eisy Myanmar',
    ],
  };

  const html = `${layoutHead({
    title,
    description: post.description,
    keywords: post.keywords,
    canonical,
    locale: post.locale,
    lang: post.lang,
    ogType: 'article',
    jsonLd,
  })}
<body class="legal-doc">
  <main class="legal-page blog-page blog-article">
    <a class="legal-back" href="/blog">&larr; All guides</a>
    ${siteNav('/blog')}
    <header class="blog-article-header">
      <p class="blog-card-meta">${esc(post.heroLabel)} · Updated ${esc(post.updatedAt)} · ${post.readingMinutes} min read</p>
      <h1>${esc(post.title)}</h1>
      <p class="meta">${esc(post.description)}</p>
    </header>
    ${ctaBanner()}
    <article>
${articleBody}
    </article>
    ${ctaBanner()}
    <p class="blog-related"><a href="/blog">More Visa card guides</a> · <a href="/faq">FAQ</a> · <a href="/">Open Eisy Myanmar</a></p>
    <p class="legal-footer-copyright">© 2026 Eisy Myanmar. All rights reserved.</p>
  </main>
</body>
</html>
`;

  const outDir = path.join(blogDir, post.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`[build-blog] wrote blog/${post.slug}/index.html`);
}

function writeSitemap(posts) {
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE_ORIGIN}/blog`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${SITE_ORIGIN}/faq`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${SITE_ORIGIN}/about`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_ORIGIN}/terms`, priority: '0.3', changefreq: 'yearly' },
    { loc: `${SITE_ORIGIN}/privacy`, priority: '0.3', changefreq: 'yearly' },
    { loc: `${SITE_ORIGIN}/refund`, priority: '0.3', changefreq: 'yearly' },
  ];
  const blogUrls = posts.map((p) => ({
    loc: `${SITE_ORIGIN}/blog/${p.slug}`,
    priority: '0.8',
    changefreq: 'monthly',
    lastmod: p.updatedAt || p.publishedAt,
  }));

  const urls = [...staticUrls, ...blogUrls];
  const body = urls.map((u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), xml);
  console.log('[build-blog] updated sitemap.xml with blog URLs');
}

function main() {
  const posts = getAllPosts();
  if (!posts.length) throw new Error('No blog posts found in data/blogs.js');
  // Clear stale generated posts (keep directory)
  if (fs.existsSync(blogDir)) {
    for (const name of fs.readdirSync(blogDir)) {
      const full = path.join(blogDir, name);
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
  writeIndex(posts);
  for (const post of posts) writePost(post);
  writeSitemap(posts);
  console.log(`[build-blog] done — ${getAllSlugs().length} posts`);
}

main();
