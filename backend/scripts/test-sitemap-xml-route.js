#!/usr/bin/env node
/**
 * Smoke-test GET /sitemap.xml: valid XML body + application/xml Content-Type.
 */
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { app } = require('../src/index.js');
const { getAllSlugs } = require('../../data/blogs.js');

function request(server, urlPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers: { Accept: 'application/xml,text/xml,*/*' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const res = await request(server, '/sitemap.xml');
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);

    const ct = String(res.headers['content-type'] || '');
    assert.ok(
      ct.includes('application/xml'),
      `Content-Type must be application/xml, got: ${ct}`
    );
    assert.ok(!ct.includes('text/html'), `must not be text/html: ${ct}`);

    assert.ok(res.body.startsWith('<?xml'), 'XML declaration');
    assert.ok(res.body.includes('<urlset'), 'has <urlset>');
    assert.ok(res.body.includes('</urlset>'), 'closes </urlset>');
    assert.ok(res.body.includes('<url>'), 'has <url>');
    assert.ok(res.body.includes('<loc>'), 'has <loc>');
    assert.ok(res.body.includes('<loc>https://eisymyanmar.com/blog</loc>'));

    for (const slug of getAllSlugs()) {
      assert.ok(
        res.body.includes(`<loc>https://eisymyanmar.com/blog/${slug}</loc>`),
        `missing blog slug ${slug}`
      );
    }

    // Plain-text-only body would omit tags; ensure tags are literally present.
    const tagCount = (res.body.match(/<\/?url>/g) || []).length;
    assert.ok(tagCount >= 2, `expected <url> tags in body, found ${tagCount}`);

    console.log('ok — /sitemap.xml application/xml with urlset + blog locs');
    console.log(`content-type: ${ct}`);
    console.log(`bytes: ${Buffer.byteLength(res.body, 'utf8')}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
