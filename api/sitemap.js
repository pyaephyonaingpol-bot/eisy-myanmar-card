/**
 * Dedicated Vercel serverless handler for /sitemap.xml.
 * Root vercel.json rewrites /sitemap.xml → /api/sitemap so this file owns
 * Content-Type (avoids static public/sitemap.xml or SPA HTML fallback).
 */
'use strict';

const { buildSitemapXml } = require('../backend/src/lib/sitemapXml');

function sendXml(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

module.exports = (req, res) => {
  if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.end();
    return;
  }

  try {
    const xml = buildSitemapXml();
    if (!xml.includes('<urlset') || !xml.includes('<loc>')) {
      throw new Error('invalid sitemap xml');
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
