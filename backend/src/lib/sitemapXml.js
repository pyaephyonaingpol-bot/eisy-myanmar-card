/**
 * Build a valid XML sitemap string (application/xml body).
 * Shared by Express /sitemap.xml and the blog SSG writer.
 */
'use strict';

const path = require('path');

const SITE_ORIGIN = 'https://eisymyanmar.com';

function loadBlogPosts() {
  try {
    // data/blogs.js lives at repo root (monorepo).
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const blogs = require(path.join(__dirname, '../../../data/blogs.js'));
    return typeof blogs.getAllPosts === 'function' ? blogs.getAllPosts() : (blogs.posts || []);
  } catch (err) {
    console.warn('[sitemap] blog posts unavailable:', err.message);
    return [];
  }
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const lines = [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
  ];
  if (lastmod) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
  if (changefreq) lines.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`);
  if (priority != null) lines.push(`    <priority>${escapeXml(priority)}</priority>`);
  lines.push('  </url>');
  return lines.join('\n');
}

/**
 * @returns {string} Full XML document including XML declaration + urlset.
 */
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function buildSitemapXml(posts = loadBlogPosts()) {
  const fallbackLastmod = todayStamp();
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: fallbackLastmod, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/blog`, lastmod: fallbackLastmod, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE_ORIGIN}/faq`, lastmod: fallbackLastmod, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE_ORIGIN}/about`, lastmod: fallbackLastmod, changefreq: 'monthly', priority: '0.8' },
    { loc: `${SITE_ORIGIN}/terms`, lastmod: fallbackLastmod, changefreq: 'yearly', priority: '0.3' },
    { loc: `${SITE_ORIGIN}/privacy`, lastmod: fallbackLastmod, changefreq: 'yearly', priority: '0.3' },
    { loc: `${SITE_ORIGIN}/refund`, lastmod: fallbackLastmod, changefreq: 'yearly', priority: '0.3' },
  ];

  const blogUrls = (posts || []).map((p) => ({
    loc: `${SITE_ORIGIN}/blog/${p.slug}`,
    lastmod: p.updatedAt || p.publishedAt || fallbackLastmod,
    changefreq: 'monthly',
    priority: '0.8',
  }));

  const entries = [...staticUrls, ...blogUrls].map(urlEntry).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

module.exports = {
  SITE_ORIGIN,
  buildSitemapXml,
  loadBlogPosts,
  escapeXml,
};
