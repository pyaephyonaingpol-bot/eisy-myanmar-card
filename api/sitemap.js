/**
 * Dedicated Vercel serverless handler for GET /sitemap.xml
 * (vercel.json rewrites /sitemap.xml → /api/sitemap).
 *
 * Self-contained XML builder so a missing dependency cannot fall through
 * to Express/SPA HTML (browsers then strip <urlset>/<url>/<loc> tags).
 */
'use strict';

const path = require('path');

const SITE = 'https://eisymyanmar.com';
const XML_TYPE = 'application/xml; charset=utf-8';

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadBlogPosts() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'blogs.js'),
    path.join(__dirname, '..', 'backend', '..', 'data', 'blogs.js'),
  ];
  for (const file of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const blogs = require(file);
      if (typeof blogs.getAllPosts === 'function') return blogs.getAllPosts();
      if (Array.isArray(blogs.posts)) return blogs.posts;
    } catch (_) {
      /* try next */
    }
  }
  return [];
}

function urlXml({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : null,
    priority != null ? `    <priority>${escapeXml(priority)}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n');
}

function buildXml() {
  // Prefer shared builder when the serverless bundle includes it.
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { buildSitemapXml } = require(path.join(__dirname, '..', 'backend', 'src', 'lib', 'sitemapXml'));
    const xml = buildSitemapXml();
    if (xml && xml.includes('<urlset') && xml.includes('<loc>')) return xml;
  } catch (_) {
    /* fall through to inline builder */
  }

  const lastmod = today();
  const staticUrls = [
    { loc: `${SITE}/`, lastmod, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE}/blog`, lastmod, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE}/faq`, lastmod, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE}/about`, lastmod, changefreq: 'monthly', priority: '0.8' },
    { loc: `${SITE}/terms`, lastmod, changefreq: 'yearly', priority: '0.3' },
    { loc: `${SITE}/privacy`, lastmod, changefreq: 'yearly', priority: '0.3' },
    { loc: `${SITE}/refund`, lastmod, changefreq: 'yearly', priority: '0.3' },
  ];
  const blogUrls = loadBlogPosts().map((p) => ({
    loc: `${SITE}/blog/${p.slug}`,
    lastmod: p.updatedAt || p.publishedAt || lastmod,
    changefreq: 'monthly',
    priority: '0.8',
  }));
  const entries = [...staticUrls, ...blogUrls].map(urlXml).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function applyXmlHeaders(res) {
  res.setHeader('Content-Type', XML_TYPE);
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-cache');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Sitemap-Handler', 'api/sitemap');
}

function sendXml(res, status, body) {
  res.statusCode = status;
  applyXmlHeaders(res);
  res.end(body);
}

module.exports = (req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    applyXmlHeaders(res);
    res.end();
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const xml = buildXml();
    if (!xml.startsWith('<?xml') || !xml.includes('<urlset') || !xml.includes('<loc>')) {
      throw new Error('sitemap builder produced non-XML body');
    }
    if (method === 'HEAD') {
      res.statusCode = 200;
      applyXmlHeaders(res);
      res.setHeader('Content-Length', Buffer.byteLength(xml, 'utf8'));
      res.end();
      return;
    }
    sendXml(res, 200, xml);
  } catch (err) {
    console.error('[api/sitemap]', err && err.message ? err.message : err);
    sendXml(
      res,
      500,
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
    );
  }
};
