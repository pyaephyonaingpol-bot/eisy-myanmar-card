/**
 * Dedicated Vercel serverless handler for /robots.txt
 * (rewritten from /robots.txt so static MIME never wins as text/html).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROBOTS_PATH = path.join(__dirname, '..', 'backend', 'public', 'robots.txt');

module.exports = (req, res) => {
  try {
    const body = fs.readFileSync(ROBOTS_PATH, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(body);
  } catch (err) {
    console.error('[api/robots]', err && err.message ? err.message : err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('robots unavailable\n');
  }
};
